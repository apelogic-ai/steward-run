import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Readable } from "node:stream";
import { createInputArchive, extractOutputArchive, parseWorkspacePaths } from "./archive.js";
import type { ActionConfig } from "./config.js";
import type { CreateRunRequest, Run } from "./steward-client.js";

export interface RunClient {
  createRun(request: CreateRunRequest, idempotencyKey: string): Promise<Run>;
  uploadInputs(runUid: string, createArchive: () => Promise<Readable>): Promise<void>;
  executeRun(runUid: string): Promise<Run>;
  getRun(runUid: string): Promise<Run>;
  downloadOutputs(runUid: string): Promise<Readable>;
  finalizeRun(runUid: string): Promise<Run>;
}

interface LifecycleDependencies {
  client: RunClient;
  environment: NodeJS.ProcessEnv;
  setOutput: (name: "status" | "runtime-uid", value: string) => Promise<void>;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}

const terminalPhases = new Set<Run["phase"]>(["succeeded", "parked", "failed", "cancelled"]);

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
  const error = new Error("Steward run was cancelled");
  error.name = "AbortError";
  return error;
}

async function pollUntilTerminal(
  initial: Run,
  client: RunClient,
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
): Promise<Run> {
  let current = initial;
  let interval = 1_000;
  while (!terminalPhases.has(current.phase)) {
    if (signal?.aborted) throw abortError();
    await sleep(interval, signal);
    if (signal?.aborted) throw abortError();
    current = await client.getRun(current.runUid);
    if (current.runUid !== initial.runUid || current.runtimeUid !== initial.runtimeUid) {
      throw new Error("Steward changed run identity while polling");
    }
    interval = Math.min(interval * 2, 10_000);
  }
  return current;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function finalizeAndConfirm(
  run: Run,
  client: RunClient,
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
): Promise<void> {
  let current = await client.finalizeRun(run.runUid);
  for (let attempt = 0; !current.finalized && attempt < 6; attempt += 1) {
    await sleep(Math.min(250 * 2 ** attempt, 2_000));
    current = await client.getRun(run.runUid);
    if (current.runUid !== run.runUid || current.runtimeUid !== run.runtimeUid) {
      throw new Error("Steward changed run identity during finalization");
    }
  }
  if (!current.finalized) throw new Error("Steward did not confirm run finalization");
}

export async function runWorkflow(
  config: ActionConfig,
  workspace: string,
  dependencies: LifecycleDependencies,
): Promise<Run> {
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
  let created: Run | undefined;
  let primaryError: unknown;
  try {
    created = await dependencies.client.createRun(
      {
        workflow: config.workflow,
        codingAgentRuntime: config.codingAgentRuntime,
        ...(config.agentRuntime ? { agentRuntimeUid: config.agentRuntime } : {}),
      },
      createIdempotencyKey(dependencies.environment),
    );
    await dependencies.setOutput("runtime-uid", created.runtimeUid);
    await dependencies.client.uploadInputs(created.runUid, createArchive);
    const executing = await dependencies.client.executeRun(created.runUid);
    const terminal = await pollUntilTerminal(
      executing,
      dependencies.client,
      sleep,
      dependencies.signal,
    );
    await dependencies.setOutput("status", terminal.phase);
    if (terminal.phase === "succeeded") {
      await extractOutputArchive(
        await dependencies.client.downloadOutputs(terminal.runUid),
        workspace,
        outputPaths,
      );
      return terminal;
    }
    if (terminal.phase === "parked") return terminal;
    throw new Error(`Steward run ${terminal.phase}${terminal.message ? `: ${terminal.message}` : ""}`);
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
            `Steward run failed and cleanup failed: ${errorMessage(cleanupError)}`,
          );
        }
        throw cleanupError;
      }
    }
  }
}
