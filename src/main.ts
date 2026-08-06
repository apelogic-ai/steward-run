import { appendFile } from "node:fs/promises";
import { shortLivedBearerTokenFileProvider } from "./auth.js";
import { readActionConfig } from "./config.js";
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

export async function main(): Promise<void> {
  const config = readActionConfig(process.env);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const getToken = (() => {
      switch (config.authentication.kind) {
        case "github-oidc-exchange":
          return identityExchangeTokenProvider(process.env, config.authentication.url);
        case "github-oidc":
          return oidcTokenProvider(process.env, config.authentication.audience);
        case "bearer-token-file":
          return shortLivedBearerTokenFileProvider(config.authentication.path);
      }
    })();
    const client = new StewardClient({
      baseUrl: config.apiUrl,
      getToken,
      fetch: await createStewardFetch(config.caCertificateFile),
    });
    await runWorkflow(config, requiredEnvironment("GITHUB_WORKSPACE"), {
      client,
      environment: process.env,
      setOutput: setActionOutput,
      signal: controller.signal,
    });
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}

if (process.env.STEWARD_RUN_WORKFLOW !== undefined) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`steward-run: ${message}\n`);
    process.exitCode = 1;
  });
}
