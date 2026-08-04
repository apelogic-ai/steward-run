import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Readable } from "node:stream";
import { createInputArchive, extractOutputArchive, parseWorkspacePaths } from "./archive.js";
import type { ActionConfig } from "./config.js";
import type { Task, TaskSubmissionRequest } from "./steward-client.js";

export interface TaskClient {
  submitTask(request: TaskSubmissionRequest, idempotencyKey: string): Promise<Task>;
  uploadTaskInputs(taskUid: string, createArchive: () => Promise<Readable>): Promise<void>;
  executeTask(taskUid: string): Promise<Task>;
  getTask(taskUid: string): Promise<Task>;
  downloadTaskOutputs(taskUid: string): Promise<Readable>;
  finalizeTask(taskUid: string): Promise<Task>;
}

interface LifecycleDependencies {
  client: TaskClient;
  environment: NodeJS.ProcessEnv;
  setOutput: (name: "status" | "task-uid" | "runtime-uid", value: string) => Promise<void>;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}

const terminalPhases = new Set<Task["phase"]>(["succeeded", "failed", "cancelled"]);

function identityField(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`required GitHub job identity ${name} is missing`);
  return value;
}

export function createIdempotencyKey(environment: NodeJS.ProcessEnv): string {
  const identity = [
    identityField(environment, "GITHUB_REPOSITORY"),
    identityField(environment, "GITHUB_RUN_ID"),
    identityField(environment, "GITHUB_RUN_ATTEMPT"),
    identityField(environment, "GITHUB_JOB"),
  ].join("\0");
  return createHash("sha256").update(identity).digest("hex");
}

function abortError(): Error {
  const error = new Error("Steward Task was cancelled");
  error.name = "AbortError";
  return error;
}

async function pollUntilTerminal(
  initial: Task,
  client: TaskClient,
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
): Promise<Task> {
  let current = initial;
  let interval = 1_000;
  while (!terminalPhases.has(current.phase)) {
    if (signal?.aborted) throw abortError();
    await sleep(interval, signal);
    if (signal?.aborted) throw abortError();
    current = await client.getTask(current.taskUid);
    if (current.taskUid !== initial.taskUid || current.runtimeUid !== initial.runtimeUid) {
      throw new Error("Steward changed Task identity while polling");
    }
    interval = Math.min(interval * 2, 10_000);
  }
  return current;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function finalizeAndConfirm(
  task: Task,
  client: TaskClient,
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
): Promise<void> {
  let current = await client.finalizeTask(task.taskUid);
  for (let attempt = 0; !current.finalized && attempt < 120; attempt += 1) {
    await sleep(Math.min(250 * 2 ** attempt, 2_000));
    current = await client.getTask(task.taskUid);
    if (current.taskUid !== task.taskUid || current.runtimeUid !== task.runtimeUid) {
      throw new Error("Steward changed Task identity during finalization");
    }
  }
  if (!current.finalized) throw new Error("Steward did not confirm Task finalization");
}

export async function runWorkflow(
  config: ActionConfig,
  workspace: string,
  dependencies: LifecycleDependencies,
): Promise<Task> {
  const inputPaths = parseWorkspacePaths(config.inputPaths);
  const outputPaths = parseWorkspacePaths(config.outputPaths);
  let initialArchive: Readable | undefined = await createInputArchive(workspace, inputPaths);
  const createArchive = async (): Promise<Readable> => {
    if (initialArchive) {
      const archive = initialArchive;
      initialArchive = undefined;
      return archive;
    }
    return createInputArchive(workspace, inputPaths);
  };
  const sleep =
    dependencies.sleep ??
    (async (milliseconds: number, signal?: AbortSignal) => delay(milliseconds, undefined, { signal }));
  let created: Task | undefined;
  let primaryError: unknown;
  try {
    created = await dependencies.client.submitTask(
      {
        workflow: config.workflow,
        codingAgentRuntime: config.codingAgentRuntime,
        ...(config.agentRuntime ? { agentRuntimeUid: config.agentRuntime } : {}),
      },
      createIdempotencyKey(dependencies.environment),
    );
    await dependencies.setOutput("task-uid", created.taskUid);
    await dependencies.setOutput("runtime-uid", created.runtimeUid);
    await dependencies.client.uploadTaskInputs(created.taskUid, createArchive);
    const executing = await dependencies.client.executeTask(created.taskUid);
    const terminal = await pollUntilTerminal(
      executing,
      dependencies.client,
      sleep,
      dependencies.signal,
    );
    await dependencies.setOutput("status", terminal.phase);
    if (terminal.phase === "succeeded") {
      await extractOutputArchive(
        await dependencies.client.downloadTaskOutputs(terminal.taskUid),
        workspace,
        outputPaths,
      );
      return terminal;
    }
    throw new Error(
      `Steward Task ${terminal.phase}${terminal.failureReason ? `: ${terminal.failureReason}` : ""}`,
    );
  } catch (error) {
    primaryError = error;
    if (created && error instanceof Error && error.name === "AbortError") {
      await dependencies.setOutput("status", "cancelled");
    }
    throw error;
  } finally {
    if (created) {
      try {
        await finalizeAndConfirm(created, dependencies.client, sleep);
      } catch (cleanupError) {
        if (primaryError) {
          throw new AggregateError(
            [primaryError, cleanupError],
            `Steward Task failed and cleanup failed: ${errorMessage(cleanupError)}`,
          );
        }
        throw cleanupError;
      }
    }
  }
}
