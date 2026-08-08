import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { startMockSteward } from "./support/mock-steward.ts";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.test-signature`;
}

test("the checked-in bundle round-trips a file through the mock Steward API", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "steward-run-bundle-"));
  const outputFile = join(workspace, "github-output");
  const finalizationMarker = join(workspace, "mock-finalized");
  const mock = await startMockSteward({ finalizationMarker });
  const payload = Buffer.from([0x00, 0x01, 0x02, 0x0a, 0x0d, 0x7f, 0x80, 0xfe, 0xff]);
  try {
    await mkdir(join(workspace, "in"));
    await writeFile(join(workspace, "in", "payload.bin"), payload);
    await writeFile(outputFile, "");
    const child = spawn(process.execPath, ["dist/index.cjs"], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        ACTIONS_ID_TOKEN_REQUEST_URL: `${mock.url}/oidc?api-version=1`,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
        GITHUB_JOB: "agent",
        GITHUB_OUTPUT: outputFile,
        GITHUB_REPOSITORY: "apelogic-ai/example",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_RUN_ID: "123",
        GITHUB_WORKSPACE: workspace,
        STEWARD_RUN_API_URL: mock.url,
        STEWARD_RUN_CODING_AGENT_RUNTIME: "claude-code@2.1.220",
        STEWARD_RUN_IDENTITY_EXCHANGE_URL: `${mock.url}/v1/exchange`,
        STEWARD_RUN_INPUTS: "in",
        STEWARD_RUN_OUTPUTS: "out",
        STEWARD_RUN_WORKFLOW: "copy-smoke",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += String(chunk)));
    const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    assert.equal(code, 0, stderr);
    assert.deepEqual(await readFile(join(workspace, "out", "payload.bin")), payload);
    assert.match(await readFile(outputFile, "utf8"), /status=succeeded/);
    assert.match(await readFile(outputFile, "utf8"), /task-uid=[0-9a-f-]+/);
    assert.match(await readFile(outputFile, "utf8"), /runtime-uid=mock-runtime-uid/);
    assert.match(await readFile(finalizationMarker, "utf8"), /^[0-9a-f-]+\n$/u);
    assert.ok(mock.observations.oidcRequests >= 5);
    assert.equal(mock.observations.exchangeRequests, mock.observations.oidcRequests);
    assert.equal(mock.observations.sourceTokenAtSteward, 0);
    assert.equal(mock.observations.stewardTokenAtExchange, 0);
    assert.ok(mock.observations.stewardTokenAtSteward >= 5);
    assert.deepEqual(mock.observations.operations, [
      "submit",
      "upload-inputs",
      "execute",
      "poll",
      "download-outputs",
      "finalize",
    ]);
    assert.deepEqual(
      {
        created: mock.observations.created,
        uploaded: mock.observations.uploaded,
        executed: mock.observations.executed,
        polled: mock.observations.polled,
        downloaded: mock.observations.downloaded,
        finalized: mock.observations.finalized,
      },
      {
        created: true,
        uploaded: true,
        executed: true,
        polled: true,
        downloaded: true,
        finalized: true,
      },
    );
  } finally {
    await mock.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test("the mock rejects workflows other than copy-smoke", async () => {
  const mock = await startMockSteward();
  try {
    const oidcResponse = await fetch(
      `${mock.url}/oidc?audience=apelogic-github-identity-exchange`,
      { headers: { authorization: "Bearer request-secret" } },
    );
    const sourceToken = (await oidcResponse.json() as { value: string }).value;
    const exchangeResponse = await fetch(`${mock.url}/v1/exchange`, {
      method: "POST",
      headers: { authorization: `Bearer ${sourceToken}` },
    });
    const stewardToken = (await exchangeResponse.json() as { access_token: string }).access_token;
    const response = await fetch(`${mock.url}/v1/tasks`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${stewardToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workflow: "cve-triage",
        codingAgentRuntime: "claude-code@2.1.220",
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { message: "mock only supports workflow copy-smoke" });
  } finally {
    await mock.close();
  }
});

test("external GitHub OIDC acceptance is audience-bound and explicitly test-only", async () => {
  const sourceToken = jwt({
    aud: "apelogic-github-identity-exchange",
    sub: "github-actions-caller",
  });
  const wrongAudienceToken = jwt({ aud: "steward-task-api", sub: "github-actions-caller" });
  const strictMock = await startMockSteward();
  try {
    const response = await fetch(`${strictMock.url}/v1/exchange`, {
      method: "POST",
      headers: { authorization: `Bearer ${sourceToken}` },
    });
    assert.equal(response.status, 401);
  } finally {
    await strictMock.close();
  }

  const actionsMock = await startMockSteward({ acceptExternalGithubOidcToken: true });
  try {
    const wrongAudienceResponse = await fetch(`${actionsMock.url}/v1/exchange`, {
      method: "POST",
      headers: { authorization: `Bearer ${wrongAudienceToken}` },
    });
    assert.equal(wrongAudienceResponse.status, 401);

    const exchangeResponse = await fetch(`${actionsMock.url}/v1/exchange`, {
      method: "POST",
      headers: { authorization: `Bearer ${sourceToken}` },
    });
    assert.equal(exchangeResponse.status, 200);

    const stewardResponse = await fetch(`${actionsMock.url}/v1/tasks`, {
      method: "POST",
      headers: { authorization: `Bearer ${sourceToken}` },
    });
    assert.equal(stewardResponse.status, 401);
    assert.equal(actionsMock.observations.sourceTokenAtExchange, 1);
    assert.equal(actionsMock.observations.sourceTokenAtSteward, 1);
  } finally {
    await actionsMock.close();
  }
});
