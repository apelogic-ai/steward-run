import { appendFile } from "node:fs/promises";
import {
  discoverTaskAuthentication,
  discoveredIdentityExchangeTokenProvider,
} from "./auth-discovery.js";
import { shortLivedBearerTokenFileProvider } from "./auth.js";
import {
  compatibilityInputNotice,
  implicitIdentityExchangeAudienceNotice,
  readActionConfig,
  usedCompatibilityInputs,
} from "./config.js";
import {
  FAILURE_METADATA_VERSION,
  StewardRunFailure,
  publishFailureMetadata,
  sanitizeFailureMetadata,
  type FailureMetadata,
} from "./failure-metadata.js";
import { identityExchangeTokenProvider } from "./identity-exchange.js";
import { runWorkflow } from "./lifecycle.js";
import { oidcTokenProvider } from "./oidc.js";
import { StewardClient } from "./steward-client.js";
import { createStewardFetch, type CloseableFetch } from "./transport.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`required GitHub environment ${name} is missing`);
  return value;
}

type ActionOutputName =
  | "failure-category"
  | "http-status"
  | "outcome"
  | "runtime-uid"
  | "status"
  | "task-uid";

async function setActionOutput(name: ActionOutputName, value: string): Promise<void> {
  if (!/^[a-z-]+$/u.test(name) || /[\r\n]/u.test(value)) {
    throw new Error("refusing to write an unsafe GitHub Actions output");
  }
  await appendFile(requiredEnvironment("GITHUB_OUTPUT"), `${name}=${value}\n`, {
    encoding: "utf8",
  });
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

async function reportActionFailure(failure: StewardRunFailure): Promise<void> {
  const safe = sanitizeFailureMetadata(failure.metadata);
  await publishFailureMetadata(safe, {
    writeAnnotation: async (value) => {
      process.stdout.write(`::error title=Steward governed Task failed::${value}\n`);
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
    await setActionOutput("outcome", "failure");
    await setActionOutput("failure-category", safe.failureCategory);
    await setActionOutput("http-status", safe.httpStatus?.toString() ?? "");
  } catch {
    // Output publication must never replace or disclose the primary governed failure.
  }
}

export async function main(): Promise<void> {
  const controller = new AbortController();
  const transports = new Set<CloseableFetch>();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
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
    const githubFetch = await createStewardFetch();
    transports.add(githubFetch);
    const stewardFetch = await createStewardFetch(config.caCertificateFile);
    transports.add(stewardFetch);
    const discovered = "packagePath" in config
      ? await discoverTaskAuthentication(
          config.apiUrl,
          stewardFetch,
          controller.signal,
        )
      : undefined;
    if (discovered && !discovered.packagePathSupported) {
      process.stdout.write(
        "::error title=Unsupported Steward capability::package-path requires Steward 0.3.9 or later with advertised package-path support\n",
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
    const client = new StewardClient({
      baseUrl: config.apiUrl,
      getToken,
      fetch: stewardFetch,
    });
    await runWorkflow(config, requiredEnvironment("GITHUB_WORKSPACE"), {
      client,
      environment: process.env,
      setOutput: setActionOutput,
      signal: controller.signal,
      runtimeBindingTimeoutMilliseconds: config.runtimeBindingTimeoutMilliseconds,
    });
    await setActionOutput("outcome", "success");
    await setActionOutput("failure-category", "");
    await setActionOutput("http-status", "");
  } catch (error) {
    const failure = safeFailure(error);
    await reportActionFailure(failure);
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
