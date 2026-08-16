import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Readable } from "node:stream";
import { createInputArchive, extractOutputArchive, parseWorkspacePaths } from "./archive.js";
import type { WorkflowConfig } from "./config.js";
import {
  FAILURE_METADATA_VERSION,
  StewardRunFailure,
  classifyAssertionStage,
  classifyFailureReason,
  classifyProviderConnectionStage,
  classifyProviderConnectionStageV2,
  type AssertionStage,
  type CleanupCategory,
  type FailureCategory,
  type FailurePhase,
  type ProviderConnectionStage,
  type ProviderConnectionStageV2,
} from "./failure-metadata.js";
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

class FinalizationFailure extends Error {
  readonly category: Exclude<CleanupCategory, "confirmed" | "not-required">;

  constructor(category: Exclude<CleanupCategory, "confirmed" | "not-required">) {
    super("Steward Task finalization failed");
    this.name = "FinalizationFailure";
    this.category = category;
  }
}

async function finalizeAndConfirm(
  task: Task,
  client: TaskClient,
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
): Promise<void> {
  try {
    let current = await client.finalizeTask(task.taskUid);
    for (let attempt = 0; !current.finalized && attempt < 120; attempt += 1) {
      await sleep(Math.min(250 * 2 ** attempt, 2_000));
      current = await client.getTask(task.taskUid);
      if (current.taskUid !== task.taskUid || current.runtimeUid !== task.runtimeUid) {
        throw new FinalizationFailure("identity-mismatch");
      }
    }
    if (!current.finalized) throw new FinalizationFailure("confirmation-timeout");
  } catch (error) {
    if (error instanceof FinalizationFailure) throw error;
    throw new FinalizationFailure("request-failed");
  }
}

type WorkflowStage = "input" | "submit" | "upload" | "execute" | "poll" | "output";

function taskFailurePhase(task: Task | undefined): FailurePhase {
  if (
    task?.phase === "succeeded" ||
    task?.phase === "failed" ||
    task?.phase === "cancelled"
  ) {
    return task.phase;
  }
  return "unavailable";
}

function stageFailureCategory(stage: WorkflowStage, error: unknown): FailureCategory {
  if (error instanceof Error && error.name === "AbortError") return "cancelled";
  switch (stage) {
    case "input":
    case "upload":
    case "output":
      return "input-output";
    case "execute":
      return "execution";
    case "submit":
    case "poll":
      return "dependency";
  }
}

export async function runWorkflow(
  config: WorkflowConfig,
  workspace: string,
  dependencies: LifecycleDependencies,
): Promise<Task> {
  let initialArchive: Readable | undefined;
  let inputPaths: string[] = [];
  let outputPaths: string[] = [];
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
  let terminal: Task | undefined;
  let result: Task | undefined;
  let failurePhase: FailurePhase = "unavailable";
  let failureCategory: FailureCategory = "unknown";
  let assertionStage: AssertionStage | undefined;
  let providerConnectionStage: ProviderConnectionStage | undefined;
  let providerConnectionStageV2: ProviderConnectionStageV2 | undefined;
  let failed = false;
  let stage: WorkflowStage = "input";
  try {
    inputPaths = parseWorkspacePaths(config.inputPaths);
    outputPaths = parseWorkspacePaths(config.outputPaths);
    initialArchive = await createInputArchive(workspace, inputPaths);
    stage = "submit";
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
    stage = "upload";
    await dependencies.client.uploadTaskInputs(created.taskUid, createArchive);
    stage = "execute";
    const executing = await dependencies.client.executeTask(created.taskUid);
    stage = "poll";
    terminal = await pollUntilTerminal(
      executing,
      dependencies.client,
      sleep,
      dependencies.signal,
    );
    failurePhase = taskFailurePhase(terminal);
    if (terminal.phase !== "succeeded") {
      failed = true;
      failureCategory = terminal.phase === "cancelled"
        ? "cancelled"
        : classifyFailureReason(terminal.failureReason);
      assertionStage = terminal.phase === "cancelled"
        ? undefined
        : classifyAssertionStage(terminal.failureReason);
      providerConnectionStage = terminal.phase === "cancelled"
        ? undefined
        : classifyProviderConnectionStage(terminal.failureReason);
      providerConnectionStageV2 = terminal.phase === "cancelled"
        ? undefined
        : classifyProviderConnectionStageV2(terminal.failureReason);
    }
    await dependencies.setOutput("status", terminal.phase);
    if (!failed) {
      stage = "output";
      await extractOutputArchive(
        await dependencies.client.downloadTaskOutputs(terminal.taskUid),
        workspace,
        outputPaths,
      );
      result = terminal;
    }
  } catch (error) {
    if (!failed) {
      failed = true;
      failurePhase = terminal
        ? taskFailurePhase(terminal)
        : (error instanceof Error && error.name === "AbortError" ? "cancelled" : "unavailable");
      failureCategory = stageFailureCategory(stage, error);
    }
    if (created && error instanceof Error && error.name === "AbortError") {
      try {
        await dependencies.setOutput("status", "cancelled");
      } catch {
        // A cancelled Task must still finalize; failure metadata remains bounded.
      }
    }
  }

  let cleanupCategory: CleanupCategory = "not-required";
  if (created) {
    try {
      await finalizeAndConfirm(created, dependencies.client, sleep);
      cleanupCategory = "confirmed";
    } catch (error) {
      cleanupCategory = error instanceof FinalizationFailure ? error.category : "unknown";
      failed = true;
      failurePhase = terminal ? taskFailurePhase(terminal) : failurePhase;
    }
  }

  if (failed || !result) {
    throw new StewardRunFailure({
      version: FAILURE_METADATA_VERSION,
      phase: failurePhase,
      failureCategory,
      cleanupCategory,
      ...(assertionStage === undefined ? {} : { assertionStage }),
      ...(providerConnectionStage === undefined ? {} : { providerConnectionStage }),
      ...(providerConnectionStageV2 === undefined ? {} : { providerConnectionStageV2 }),
    });
  }
  return result;
}
