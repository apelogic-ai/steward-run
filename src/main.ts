import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import {
  discoverTaskAuthentication,
  discoveredIdentityExchangeTokenProvider,
} from "./auth-discovery.js";
import { shortLivedBearerTokenFileProvider } from "./auth.js";
import {
  parseCallerOptions,
  validateIdempotencyKey,
  validateOutputsFileOption,
  validateWorkspaceOption,
} from "./cli.js";
import {
  compatibilityInputNotice,
  implicitIdentityExchangeAudienceNotice,
  readActionConfig,
  usedCompatibilityInputs,
  type ActionConfig,
} from "./config.js";
import {
  FAILURE_METADATA_VERSION,
  StewardRunFailure,
  publishFailureMetadata,
  sanitizeFailureMetadata,
  type FailureMetadata,
} from "./failure-metadata.js";
import { identityExchangeTokenProvider } from "./identity-exchange.js";
import { createIdempotencyKey, runWorkflow, type TaskClient } from "./lifecycle.js";
import { oidcTokenProvider } from "./oidc.js";
import { StewardClient, StewardRequestFailure } from "./steward-client.js";
import { createStewardFetch, type CloseableFetch } from "./transport.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`required GitHub environment ${name} is missing`);
  return value;
}

type ActionOutputName =
  | "error-code"
  | "failure-category"
  | "http-status"
  | "outcome"
  | "runtime-uid"
  | "status"
  | "task-uid";

type SetActionOutput = (name: ActionOutputName, value: string) => Promise<void>;

function actionOutputWriter(path: string | undefined): SetActionOutput {
  return async (name, value) => {
    if (!/^[a-z-]+$/u.test(name) || /[\r\n]/u.test(value)) {
      throw new Error("refusing to write an unsafe GitHub Actions output");
    }
    if (!path) throw new Error("required GitHub environment GITHUB_OUTPUT is missing");
    await appendFile(path, `${name}=${value}\n`, { encoding: "utf8" });
  };
}

function safeFailure(error: unknown): StewardRunFailure {
  if (error instanceof StewardRunFailure) return error;
  const metadata: FailureMetadata = {
    version: FAILURE_METADATA_VERSION,
    phase: "unavailable",
    failureCategory: "unknown",
    cleanupCategory: "not-required",
  };
  return new StewardRunFailure(metadata);
}

async function reportActionFailure(
  failure: StewardRunFailure,
  setActionOutput: SetActionOutput,
  stopped: boolean,
): Promise<void> {
  const safe = sanitizeFailureMetadata(failure.metadata);
  await publishFailureMetadata(safe, {
    writeAnnotation: async (value, title) => {
      process.stdout.write(
        title === undefined
          ? `::error title=Steward governed Task failed::${value}\n`
          : `::error title=${title}::${value}\n`,
      );
    },
    writeStepSummary: async (value) => {
      const path = process.env.GITHUB_STEP_SUMMARY?.trim();
      if (!path) return;
      try {
        await appendFile(path, value, { encoding: "utf8" });
      } catch {
        // Diagnostics must never replace or disclose the primary governed failure.
      }
    },
  });
  try {
    await setActionOutput("outcome", stopped ? "cancelled" : "failure");
    await setActionOutput("failure-category", safe.failureCategory);
    await setActionOutput("http-status", safe.httpStatus?.toString() ?? "");
    await setActionOutput("error-code", safe.errorCode ?? "");
  } catch {
    // Output publication must never replace or disclose the primary governed failure.
  }
}

async function stewardClient(
  config: ActionConfig,
  signal: AbortSignal,
  transports: Set<CloseableFetch>,
): Promise<StewardClient> {
  const githubFetch = await createStewardFetch();
  transports.add(githubFetch);
  const stewardFetch = await createStewardFetch(config.caCertificateFile);
  transports.add(stewardFetch);
  const discovered = "packagePath" in config
    ? await discoverTaskAuthentication(
        config.apiUrl,
        stewardFetch,
        signal,
      )
    : undefined;
  if (discovered && !discovered.packagePathSupported) {
    process.stdout.write(
      "::error title=Unsupported Steward capability::package-path requires Steward 0.3.10 or later with advertised package-path support\n",
    );
    throw new Error("Steward does not advertise package-path support");
  }
  const getToken = (() => {
    switch (config.authentication.kind) {
      case "github-oidc-discovery":
        if (discovered) {
          return identityExchangeTokenProvider(
            process.env,
            discovered.exchangeUrl,
            githubFetch,
            undefined,
            discovered.githubOidcAudience,
            stewardFetch,
          );
        }
        return discoveredIdentityExchangeTokenProvider(
          process.env,
          config.apiUrl,
          githubFetch,
          undefined,
          stewardFetch,
        );
      case "github-oidc-exchange":
        return identityExchangeTokenProvider(
          process.env,
          config.authentication.url,
          githubFetch,
          undefined,
          config.authentication.audience,
          stewardFetch,
        );
      case "github-oidc":
        return oidcTokenProvider(process.env, config.authentication.audience, githubFetch);
      case "bearer-token-file":
        return shortLivedBearerTokenFileProvider(config.authentication.path);
    }
  })();
  return new StewardClient({
    baseUrl: config.apiUrl,
    getToken,
    fetch: stewardFetch,
  });
}

// The UID of the Task this step submitted stays recorded until its cleanup was requested, so the
// action's final step can still cancel it when the job is stopped without a signal reaching this
// process (a container job's `docker exec` never forwards SIGINT or SIGTERM).
function recordingSubmittedTask(client: TaskClient, stateFile: string): TaskClient {
  return {
    submitTask: async (request, idempotencyKey) => {
      const task = await client.submitTask(request, idempotencyKey);
      try {
        await writeFile(stateFile, `${task.taskUid}\n`, { encoding: "utf8", flag: "wx" });
      } catch {
        process.stdout.write(
          "::warning title=Steward Task cancel unavailable::the submitted Task could not be recorded for cancellation if this job is stopped\n",
        );
      }
      return task;
    },
    uploadTaskInputs: (taskUid, createArchive) => client.uploadTaskInputs(taskUid, createArchive),
    executeTask: (taskUid) => client.executeTask(taskUid),
    getTask: (taskUid, options) => client.getTask(taskUid, options),
    downloadTaskLog: (taskUid, stream) => client.downloadTaskLog(taskUid, stream),
    downloadTaskOutputs: (taskUid) => client.downloadTaskOutputs(taskUid),
    finalizeTask: async (taskUid) => {
      const task = await client.finalizeTask(taskUid);
      await rm(stateFile, { force: true }).catch(() => undefined);
      return task;
    },
  };
}

const taskUidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function cancelFailureNotice(detail: string): void {
  process.stdout.write(`::error title=Steward Task cancel failed::${detail}\n`);
}

// Runs as the action's final step. It cancels only the Task UID this action invocation recorded
// after its own submission, and never fails the step: the primary outcome stays the run's own.
async function cancelRecordedTask(): Promise<void> {
  const stateFile = process.env.STEWARD_RUN_CANCEL_STATE_FILE?.trim();
  if (!stateFile) return;
  let recorded: string;
  try {
    recorded = await readFile(stateFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    cancelFailureNotice("the recorded Steward Task could not be read");
    return;
  }
  const taskUid = recorded.endsWith("\n") ? recorded.slice(0, -1) : recorded;
  if (!taskUidPattern.test(taskUid)) {
    cancelFailureNotice("the recorded value is not a Steward Task UID");
    return;
  }
  const controller = new AbortController();
  const transports = new Set<CloseableFetch>();
  try {
    const client = await stewardClient(readActionConfig(process.env), controller.signal, transports);
    await client.finalizeTask(taskUid);
    await rm(stateFile, { force: true }).catch(() => undefined);
    process.stdout.write(`Requested cancellation of Steward Task ${taskUid}\n`);
  } catch (error) {
    const status = error instanceof StewardRequestFailure && error.httpStatus !== undefined
      ? ` (HTTP ${error.httpStatus})`
      : "";
    const category = error instanceof StewardRequestFailure ? error.category : "unknown";
    cancelFailureNotice(`Steward Task ${taskUid} was not cancelled: ${category}${status}`);
  } finally {
    await Promise.allSettled([...transports].map((transport) => transport.close()));
  }
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const controller = new AbortController();
  const transports = new Set<CloseableFetch>();
  let setActionOutput = actionOutputWriter(process.env.GITHUB_OUTPUT?.trim());
  let stopped = false;
  const cancel = () => {
    stopped = true;
    controller.abort();
  };
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    const options = parseCallerOptions(args);
    if (options.cancelRecordedTask) {
      await cancelRecordedTask();
      return;
    }
    const workspace = options.workspace === undefined
      ? requiredEnvironment("GITHUB_WORKSPACE")
      : await validateWorkspaceOption(options.workspace);
    const outputsFile = options.outputsFile === undefined
      ? requiredEnvironment("GITHUB_OUTPUT")
      : await validateOutputsFileOption(workspace, options.outputsFile);
    setActionOutput = actionOutputWriter(outputsFile);
    const explicitIdempotencyKey = options.idempotencyKey ??
      (process.env.STEWARD_RUN_IDEMPOTENCY_KEY
        ? validateIdempotencyKey(process.env.STEWARD_RUN_IDEMPOTENCY_KEY)
        : undefined);
    for (const input of usedCompatibilityInputs(process.env)) {
      process.stdout.write(
        `::warning title=Deprecated steward-run input::${compatibilityInputNotice(input)}\n`,
      );
    }
    const implicitAudienceNotice = implicitIdentityExchangeAudienceNotice(process.env);
    if (implicitAudienceNotice) {
      process.stdout.write(
        `::warning title=Deprecated identity-exchange audience default::${implicitAudienceNotice}\n`,
      );
    }
    const config = readActionConfig(process.env);
    const idempotencyKey = explicitIdempotencyKey ?? createIdempotencyKey(process.env, config);
    const client = await stewardClient(config, controller.signal, transports);
    const stateFile = process.env.STEWARD_RUN_CANCEL_STATE_FILE?.trim() || undefined;
    await runWorkflow(config, workspace, {
      client: stateFile === undefined ? client : recordingSubmittedTask(client, stateFile),
      environment: process.env,
      idempotencyKey,
      setOutput: setActionOutput,
      signal: controller.signal,
      runtimeBindingTimeoutMilliseconds: config.runtimeBindingTimeoutMilliseconds,
    });
    await setActionOutput("outcome", "success");
    await setActionOutput("failure-category", "");
    await setActionOutput("http-status", "");
    await setActionOutput("error-code", "");
  } catch (error) {
    const failure = safeFailure(error);
    await reportActionFailure(failure, setActionOutput, stopped);
    throw failure;
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    await Promise.allSettled([...transports].map((transport) => transport.close()));
  }
}

if (
  process.env.STEWARD_RUN_WORKFLOW !== undefined ||
  process.env.STEWARD_RUN_INVOCATION_PATH !== undefined ||
  process.env.STEWARD_RUN_PACKAGE_PATH !== undefined
) {
  main().catch((error: unknown) => {
    process.stderr.write(`steward-run: ${safeFailure(error).message}\n`);
    process.exitCode = 1;
  });
}
