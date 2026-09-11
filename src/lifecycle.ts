import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Readable } from "node:stream";
import {
  createInputArchive,
  extractOutputArchive,
  parseWorkspacePaths,
  validateInvocationFile,
} from "./archive.js";
import type { WorkflowConfig } from "./config.js";
import { replayExecutionTranscript, type LogChannel } from "./execution-log.js";
import {
  FAILURE_METADATA_VERSION,
  StewardRunFailure,
  classifyAssertionStage,
  classifyFailureReason,
  classifyProviderConnectionStage,
  classifyProviderConnectionStageV2,
  classifyProviderConnectionStageV3,
  type AssertionStage,
  type CleanupCategory,
  type FailureCategory,
  type FailureMetadata,
  type FailurePhase,
  type ProviderConnectionStage,
  type ProviderConnectionStageV2,
  type ProviderConnectionStageV3,
} from "./failure-metadata.js";
import {
  StewardRequestFailure,
  type Task,
  type TaskRequestOptions,
  type TaskSubmissionRequest,
} from "./steward-client.js";

export interface TaskClient {
  submitTask(request: TaskSubmissionRequest, idempotencyKey: string): Promise<Task>;
  uploadTaskInputs(taskUid: string, createArchive: () => Promise<Readable>): Promise<void>;
  executeTask(taskUid: string): Promise<Task>;
  getTask(taskUid: string, options?: TaskRequestOptions): Promise<Task>;
  downloadTaskOutputs(taskUid: string): Promise<Readable>;
  finalizeTask(taskUid: string): Promise<Task>;
}

interface LifecycleDependencies {
  client: TaskClient;
  environment: NodeJS.ProcessEnv;
  setOutput: (name: "status" | "task-uid" | "runtime-uid", value: string) => Promise<void>;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  runtimeBindingTimeoutMilliseconds?: number;
  writeLog?: (channel: LogChannel, value: string | Buffer) => void | Promise<void>;
  commandToken?: () => string;
}

const terminalPhases = new Set<Task["phase"]>(["succeeded", "failed", "cancelled"]);
const runtimeBindingPollAttempts = 60;
const runtimeBindingTimeoutMilliseconds = 10 * 60 * 1_000;

type BoundTask = Task & { runtimeUid: string };

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

function timeoutError(): Error {
  return new StewardRequestFailure("poll", "timeout");
}

function boundTask(task: Task): BoundTask | undefined {
  return task.runtimeUid === null ? undefined : (task as BoundTask);
}

function taskContractMatches(initial: Task, current: Task): boolean {
  return initial.contractVersion === current.contractVersion &&
    initial.diagnostics?.executionLog === current.diagnostics?.executionLog;
}

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError();
  let rejectAbort: ((error: Error) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => rejectAbort?.(abortError());
  signal.addEventListener("abort", cancel, { once: true });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

function assertPreExecutionTask(task: BoundTask): BoundTask {
  if (task.finalized || terminalPhases.has(task.phase)) {
    throw new Error("Steward bound Task in an incompatible pre-execution state");
  }
  return task;
}

async function pollUntilRuntimeBound(
  initial: Task,
  client: TaskClient,
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
  timeoutMilliseconds = runtimeBindingTimeoutMilliseconds,
): Promise<BoundTask> {
  const alreadyBound = boundTask(initial);
  if (alreadyBound) return assertPreExecutionTask(alreadyBound);

  const controller = new AbortController();
  let deadlineExpired = false;
  const timeout = Math.max(1, timeoutMilliseconds);
  const deadline = Date.now() + timeout;
  const expire = setTimeout(() => {
    deadlineExpired = true;
    controller.abort();
  }, timeout);
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    let interval = 250;
    for (let attempt = 0; attempt < runtimeBindingPollAttempts; attempt += 1) {
      if (controller.signal.aborted) {
        if (signal?.aborted) throw abortError();
        throw timeoutError();
      }
      await abortable(sleep(interval, controller.signal), controller.signal);
      const current = await abortable(
        client.getTask(initial.taskUid, {
          signal: controller.signal,
          deadline,
        }),
        controller.signal,
      );
      if (
        current.taskUid !== initial.taskUid ||
        current.runtimeOwnership !== initial.runtimeOwnership ||
        !taskContractMatches(initial, current)
      ) {
        throw new Error("Steward changed Task identity while waiting for runtime binding");
      }
      if (current.runtimeUid === null && current.phase === "cancelled") throw abortError();
      const currentBound = boundTask(current);
      if (currentBound) return assertPreExecutionTask(currentBound);
      interval = Math.min(interval * 2, 10_000);
    }
    throw timeoutError();
  } catch (error) {
    if (controller.signal.aborted) {
      if (signal?.aborted) throw abortError();
      if (deadlineExpired) throw timeoutError();
    }
    throw error;
  } finally {
    clearTimeout(expire);
    signal?.removeEventListener("abort", cancel);
  }
}

async function pollUntilTerminal(
  initial: BoundTask,
  client: TaskClient,
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
): Promise<Task> {
  let current: Task = initial;
  let interval = 1_000;
  while (!terminalPhases.has(current.phase)) {
    if (signal?.aborted) throw abortError();
    await sleep(interval, signal);
    if (signal?.aborted) throw abortError();
    current = await client.getTask(current.taskUid);
    if (
      current.taskUid !== initial.taskUid ||
      current.runtimeUid !== initial.runtimeUid ||
      current.runtimeOwnership !== initial.runtimeOwnership ||
      !taskContractMatches(initial, current)
    ) {
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
    let finalizationRuntimeUid = task.runtimeUid;
    let current = await client.finalizeTask(task.taskUid);
    if (
      current.taskUid !== task.taskUid ||
      current.runtimeOwnership !== task.runtimeOwnership ||
      !taskContractMatches(task, current) ||
      (finalizationRuntimeUid !== null && current.runtimeUid !== finalizationRuntimeUid)
    ) {
      throw new FinalizationFailure("identity-mismatch");
    }
    finalizationRuntimeUid ??= current.runtimeUid;
    for (let attempt = 0; !current.finalized && attempt < 120; attempt += 1) {
      await sleep(Math.min(250 * 2 ** attempt, 2_000));
      current = await client.getTask(task.taskUid);
      if (
        current.taskUid !== task.taskUid ||
        current.runtimeOwnership !== task.runtimeOwnership ||
        !taskContractMatches(task, current) ||
        (finalizationRuntimeUid !== null && current.runtimeUid !== finalizationRuntimeUid)
      ) {
        throw new FinalizationFailure("identity-mismatch");
      }
      finalizationRuntimeUid ??= current.runtimeUid;
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
  if (error instanceof StewardRequestFailure) return error.category;
  if (error instanceof Error && error.name === "AbortError") return "cancelled";
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
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
  let providerConnectionStageV3: ProviderConnectionStageV3 | undefined;
  let requestStage: FailureMetadata["requestStage"];
  let httpStatus: FailureMetadata["httpStatus"];
  let correlationId: FailureMetadata["correlationId"];
  let failed = false;
  let stage: WorkflowStage = "input";
  try {
    inputPaths = parseWorkspacePaths(config.inputPaths);
    outputPaths = parseWorkspacePaths(config.outputPaths);
    if ("invocationPath" in config) {
      await validateInvocationFile(workspace, config.invocationPath);
    }
    initialArchive = await createInputArchive(workspace, inputPaths);
    stage = "submit";
    created = await dependencies.client.submitTask(
      "invocationPath" in config
        ? {
            contractVersion: "steward.task/v2",
            invocationPath: config.invocationPath,
          }
        : {
            workflow: config.workflow,
            ...(config.agentRuntime ? { agentRuntimeUid: config.agentRuntime } : {}),
          },
      createIdempotencyKey(dependencies.environment),
    );
    if (
      "invocationPath" in config &&
      (created.contractVersion !== "steward.task/v2" || created.diagnostics === undefined)
    ) {
      throw new Error("Steward omitted the direct Task contract projection");
    }
    if (
      !("invocationPath" in config) &&
      (created.contractVersion !== undefined || created.diagnostics !== undefined)
    ) {
      throw new Error("Steward returned a direct Task projection for a legacy request");
    }
    const expectedOwnership = "agentRuntime" in config && config.agentRuntime
      ? "adopted"
      : "provisioned";
    if (created.runtimeOwnership !== expectedOwnership) {
      throw new Error("Steward returned Task ownership inconsistent with the submission");
    }
    await dependencies.setOutput("task-uid", created.taskUid);
    stage = "poll";
    const bound = await pollUntilRuntimeBound(
      created,
      dependencies.client,
      sleep,
      dependencies.signal,
      dependencies.runtimeBindingTimeoutMilliseconds,
    );
    created = bound;
    await dependencies.setOutput("runtime-uid", bound.runtimeUid);
    stage = "upload";
    await dependencies.client.uploadTaskInputs(bound.taskUid, createArchive);
    stage = "execute";
    const executing = await dependencies.client.executeTask(bound.taskUid);
    const executingBound = boundTask(executing);
    if (
      !executingBound ||
      executingBound.taskUid !== bound.taskUid ||
      executingBound.runtimeUid !== bound.runtimeUid ||
      executingBound.runtimeOwnership !== bound.runtimeOwnership ||
      !taskContractMatches(bound, executingBound)
    ) {
      throw new Error("Steward changed Task identity while requesting execution");
    }
    stage = "poll";
    terminal = await pollUntilTerminal(
      executingBound,
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
      providerConnectionStageV3 = terminal.phase === "cancelled"
        ? undefined
        : classifyProviderConnectionStageV3(terminal.failureReason);
    }
    await dependencies.setOutput("status", terminal.phase);
    if (!failed) {
      stage = "output";
      const transcript = await extractOutputArchive(
        await dependencies.client.downloadTaskOutputs(terminal.taskUid),
        workspace,
        outputPaths,
        terminal.diagnostics ?? { executionLog: "off" },
      );
      if (transcript) {
        await replayExecutionTranscript(transcript, {
          ...(dependencies.writeLog === undefined ? {} : { write: dependencies.writeLog }),
          ...(dependencies.commandToken === undefined
            ? {}
            : { commandToken: dependencies.commandToken }),
        });
      }
      result = terminal;
    }
  } catch (error) {
    if (!failed) {
      failed = true;
      failurePhase = terminal
        ? taskFailurePhase(terminal)
        : (error instanceof Error && error.name === "AbortError" ? "cancelled" : "unavailable");
      failureCategory = stageFailureCategory(stage, error);
      if (error instanceof StewardRequestFailure) {
        requestStage = error.stage;
        httpStatus = error.httpStatus;
        correlationId = error.correlationId;
      }
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
      ...(providerConnectionStageV3 === undefined ? {} : { providerConnectionStageV3 }),
      ...(requestStage === undefined ? {} : { requestStage }),
      ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  }
  return result;
}
