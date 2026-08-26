import { appendFile } from "node:fs/promises";
import { shortLivedBearerTokenFileProvider } from "./auth.js";
import { readActionConfig } from "./config.js";
import {
  FAILURE_METADATA_VERSION,
  StewardRunFailure,
  publishFailureMetadata,
  type FailureMetadata,
} from "./failure-metadata.js";
import { identityExchangeTokenProvider } from "./identity-exchange.js";
import { runWorkflow } from "./lifecycle.js";
import { oidcTokenProvider } from "./oidc.js";
import { StewardClient } from "./steward-client.js";
import { createStewardFetch } from "./transport.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`required GitHub environment ${name} is missing`);
  return value;
}

async function setActionOutput(name: string, value: string): Promise<void> {
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
  await publishFailureMetadata(failure.metadata, {
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
}

export async function main(): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const config = readActionConfig(process.env);
    const stewardFetch = await createStewardFetch(config.caCertificateFile);
    const getToken = (() => {
      switch (config.authentication.kind) {
        case "github-oidc-exchange":
          return identityExchangeTokenProvider(
            process.env,
            config.authentication.url,
            undefined,
            undefined,
            config.authentication.audience,
            stewardFetch,
          );
        case "github-oidc":
          return oidcTokenProvider(process.env, config.authentication.audience);
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
    });
  } catch (error) {
    const failure = safeFailure(error);
    await reportActionFailure(failure);
    throw failure;
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}

if (process.env.STEWARD_RUN_WORKFLOW !== undefined) {
  main().catch((error: unknown) => {
    process.stderr.write(`steward-run: ${safeFailure(error).message}\n`);
    process.exitCode = 1;
  });
}
