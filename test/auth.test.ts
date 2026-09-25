import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { shortLivedBearerTokenFileProvider } from "../src/auth.ts";
import {
  compatibilityInputNotice,
  readActionConfig,
  usedCompatibilityInputs,
} from "../src/config.ts";

const baseEnvironment: NodeJS.ProcessEnv = {
  STEWARD_RUN_WORKFLOW: "repository-review@1",
  STEWARD_RUN_INPUTS: "in",
  STEWARD_RUN_OUTPUTS: "out",
  STEWARD_RUN_API_URL: "https://steward.example.test",
};

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

test("action authentication defaults to discovery and selects at most one explicit source", () => {
  assert.deepEqual(readActionConfig(baseEnvironment).authentication, {
    kind: "github-oidc-discovery",
  });
  assert.deepEqual(
    readActionConfig({
      ...baseEnvironment,
      STEWARD_RUN_IDENTITY_EXCHANGE_URL: " https://identity.example/v1/exchange ",
      STEWARD_RUN_IDENTITY_EXCHANGE_AUDIENCE: " local-github-actions-exchange ",
    }).authentication,
    {
      kind: "github-oidc-exchange",
      url: "https://identity.example/v1/exchange",
      audience: "local-github-actions-exchange",
    },
  );
  assert.deepEqual(
    readActionConfig({
      ...baseEnvironment,
      STEWARD_RUN_API_URL: "http://127.0.0.1:8080",
      STEWARD_RUN_OIDC_AUDIENCE: "steward-task-api",
    }).authentication,
    { kind: "github-oidc", audience: "steward-task-api" },
  );
  assert.deepEqual(
    readActionConfig({ ...baseEnvironment, STEWARD_RUN_BEARER_TOKEN_FILE: "/var/run/token" })
      .authentication,
    { kind: "bearer-token-file", path: "/var/run/token" },
  );
  assert.throws(
    () =>
      readActionConfig({
        ...baseEnvironment,
        STEWARD_RUN_IDENTITY_EXCHANGE_URL: "https://identity.example/v1/exchange",
        STEWARD_RUN_OIDC_AUDIENCE: "steward-task-api",
      }),
    /at most one explicit authentication method/,
  );
  assert.throws(
    () =>
      readActionConfig({
        ...baseEnvironment,
        STEWARD_RUN_IDENTITY_EXCHANGE_URL: "https://identity.example/v1/exchange",
        STEWARD_RUN_BEARER_TOKEN_FILE: "/var/run/token",
      }),
    /at most one explicit authentication method/,
  );
  assert.throws(
    () =>
      readActionConfig({
        ...baseEnvironment,
        STEWARD_RUN_IDENTITY_EXCHANGE_AUDIENCE: "local-github-actions-exchange",
      }),
    /identity-exchange-audience requires identity-exchange-url/,
  );
});

test("compatibility input notices reveal names but never supplied values", () => {
  const environment = {
    ...baseEnvironment,
    STEWARD_RUN_IDENTITY_EXCHANGE_URL: "https://secret.example/v1/exchange",
    STEWARD_RUN_IDENTITY_EXCHANGE_AUDIENCE: "secret-audience",
    STEWARD_RUN_CA_CERTIFICATE_FILE: "/secret/ca.pem",
  };
  assert.deepEqual(usedCompatibilityInputs(environment), [
    "identity-exchange-url",
    "identity-exchange-audience",
    "steward-ca-certificate-file",
  ]);
  assert.deepEqual(usedCompatibilityInputs(baseEnvironment), []);
  const notices = usedCompatibilityInputs(environment).map(compatibilityInputNotice).join("\n");
  for (const name of ["identity-exchange-url", "identity-exchange-audience", "steward-ca-certificate-file"]) {
    assert.match(notices, new RegExp(name));
  }
  assert.doesNotMatch(notices, /secret\.example|secret-audience|\/secret\/ca\.pem/u);
});

test("direct GitHub OIDC authentication is restricted to loopback Steward tests", () => {
  assert.throws(
    () =>
      readActionConfig({ ...baseEnvironment, STEWARD_RUN_OIDC_AUDIENCE: "steward-task-api" }),
    /direct GitHub OIDC authentication is only allowed with a loopback Steward API/,
  );
});

test("the trusted CA input is an optional trimmed filesystem path", () => {
  assert.equal(
    readActionConfig({
      ...baseEnvironment,
      STEWARD_RUN_IDENTITY_EXCHANGE_URL: "https://identity.example/v1/exchange",
      STEWARD_RUN_CA_CERTIFICATE_FILE: " /var/run/steward/ca.pem ",
    }).caCertificateFile,
    "/var/run/steward/ca.pem",
  );
  assert.equal(
    readActionConfig({
      ...baseEnvironment,
      STEWARD_RUN_IDENTITY_EXCHANGE_URL: "https://identity.example/v1/exchange",
    }).caCertificateFile,
    undefined,
  );
});

test("the Workflow reference is preserved byte-for-byte and runtime selection is ignored", () => {
  const config = readActionConfig({
    ...baseEnvironment,
    STEWARD_RUN_WORKFLOW: " repository-review@1 ",
    STEWARD_RUN_CODING_AGENT_RUNTIME: "caller-controlled-runtime",
    STEWARD_RUN_IDENTITY_EXCHANGE_URL: "https://identity.example/v1/exchange",
  });
  assert.equal(config.workflow, " repository-review@1 ");
  assert.equal("codingAgentRuntime" in config, false);
});

test("direct-package configuration selects one canonical invocation path without package bytes", () => {
  const direct = readActionConfig({
    ...baseEnvironment,
    STEWARD_RUN_WORKFLOW: undefined,
    STEWARD_RUN_INVOCATION_PATH: ".steward/tasks/release-summary.json",
    STEWARD_RUN_IDENTITY_EXCHANGE_URL: "https://identity.example/v1/exchange",
  });
  assert.equal(direct.invocationPath, ".steward/tasks/release-summary.json");
  assert.equal("workflow" in direct, false);

  assert.throws(
    () =>
      readActionConfig({
        ...baseEnvironment,
        STEWARD_RUN_INVOCATION_PATH: ".steward/tasks/release-summary.json",
        STEWARD_RUN_IDENTITY_EXCHANGE_URL: "https://identity.example/v1/exchange",
      }),
    /configure exactly one Task source/,
  );
  assert.throws(
    () =>
      readActionConfig({
        ...baseEnvironment,
        STEWARD_RUN_WORKFLOW: undefined,
        STEWARD_RUN_INVOCATION_PATH: ".steward/tasks/release-summary.json",
        STEWARD_RUN_AGENT_RUNTIME: "caller-selected-runtime",
        STEWARD_RUN_IDENTITY_EXCHANGE_URL: "https://identity.example/v1/exchange",
      }),
    /agent-runtime cannot be selected for a direct package invocation/,
  );
});

test("short-lived bearer token files are reread so projected credentials can rotate", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-token-"));
  const path = join(root, "token");
  const now = 1_800_000_000;
  const first = jwt({ iat: now - 10, exp: now + 300, sub: "first" });
  const second = jwt({ iat: now, exp: now + 600, sub: "second" });
  try {
    await writeFile(path, `${first}\n`, { encoding: "utf8", mode: 0o600 });
    const provider = shortLivedBearerTokenFileProvider(path, () => now);
    assert.equal(await provider(), first);
    await writeFile(path, second, "utf8");
    assert.equal(await provider(), second);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bearer token files fail closed when missing, malformed, expired, or long-lived", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-token-invalid-"));
  const path = join(root, "token");
  const now = 1_800_000_000;
  const provider = shortLivedBearerTokenFileProvider(path, () => now);
  try {
    await assert.rejects(provider(), /could not be read/);
    for (const token of [
      "inline-secret",
      jwt({ iat: now - 600, exp: now - 1 }),
      jwt({ iat: now, exp: now + 3_601 }),
      jwt({ exp: now + 300 }),
    ]) {
      await writeFile(path, token, "utf8");
      await assert.rejects(provider(), (error: Error) => {
        assert.match(error.message, /invalid short-lived bearer token/);
        assert.doesNotMatch(error.message, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
        return true;
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
