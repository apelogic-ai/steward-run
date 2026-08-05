import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { shortLivedBearerTokenFileProvider } from "../src/auth.ts";
import { readActionConfig } from "../src/config.ts";

const baseEnvironment: NodeJS.ProcessEnv = {
  STEWARD_RUN_WORKFLOW: "copy-smoke",
  STEWARD_RUN_INPUTS: "in",
  STEWARD_RUN_OUTPUTS: "out",
  STEWARD_RUN_API_URL: "https://steward.example.test",
};

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

test("action authentication selects exactly one pluggable credential source", () => {
  assert.deepEqual(
    readActionConfig({ ...baseEnvironment, STEWARD_RUN_OIDC_AUDIENCE: "steward-task-api" })
      .authentication,
    { kind: "github-oidc", audience: "steward-task-api" },
  );
  assert.deepEqual(
    readActionConfig({ ...baseEnvironment, STEWARD_RUN_BEARER_TOKEN_FILE: "/var/run/token" })
      .authentication,
    { kind: "bearer-token-file", path: "/var/run/token" },
  );
  assert.throws(() => readActionConfig(baseEnvironment), /exactly one authentication method/);
  assert.throws(
    () =>
      readActionConfig({
        ...baseEnvironment,
        STEWARD_RUN_OIDC_AUDIENCE: "steward-task-api",
        STEWARD_RUN_BEARER_TOKEN_FILE: "/var/run/token",
      }),
    /exactly one authentication method/,
  );
});

test("the trusted CA input is an optional trimmed filesystem path", () => {
  assert.equal(
    readActionConfig({
      ...baseEnvironment,
      STEWARD_RUN_OIDC_AUDIENCE: "steward-task-api",
      STEWARD_RUN_CA_CERTIFICATE_FILE: " /var/run/steward/ca.pem ",
    }).caCertificateFile,
    "/var/run/steward/ca.pem",
  );
  assert.equal(
    readActionConfig({ ...baseEnvironment, STEWARD_RUN_OIDC_AUDIENCE: "steward-task-api" })
      .caCertificateFile,
    undefined,
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
