import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { getGitHubOidcToken } from "../src/oidc.ts";
import { StewardClient, type Run } from "../src/steward-client.ts";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const run: Run = {
  runUid: "2f9f6ade-261d-4090-9532-9e157b59db2e",
  runtimeUid: "runtime-uid-1",
  phase: "accepted",
  runtimeOwnership: "provisioned",
};

test("GitHub OIDC requests preserve query parameters and bind the configured audience", async () => {
  let requested: Request | undefined;
  const token = await getGitHubOidcToken(
    "https://token.actions.example/id?api-version=1",
    "request-secret",
    "steward audience",
    async (input, init) => {
      requested = new Request(input, init);
      return jsonResponse({ value: "header.payload.signature" });
    },
  );
  assert.equal(token, "header.payload.signature");
  assert.equal(requested?.headers.get("authorization"), "Bearer request-secret");
  const url = new URL(requested?.url ?? "");
  assert.equal(url.searchParams.get("api-version"), "1");
  assert.equal(url.searchParams.get("audience"), "steward audience");
});

test("OIDC failures do not disclose request or identity tokens", async () => {
  await assert.rejects(
    getGitHubOidcToken(
      "https://token.actions.example/id",
      "request-secret",
      "steward",
      async () => new Response("leaked-id-token", { status: 403 }),
    ),
    (error: Error) => {
      assert.doesNotMatch(error.message, /request-secret|leaked-id-token/);
      assert.match(error.message, /status 403/);
      return true;
    },
  );
});

test("the Steward client obtains fresh OIDC tokens and sends an idempotency key", async () => {
  let tokenNumber = 0;
  const requests: Request[] = [];
  const client = new StewardClient({
    baseUrl: "https://steward.example.test/control/",
    getToken: async () => `token-${++tokenNumber}`,
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return jsonResponse(run, requests.length === 1 ? 201 : 200);
    },
    sleep: async () => undefined,
  });

  await client.createRun(
    { workflow: "cve-triage", codingAgentRuntime: "claude-code@2.1.220" },
    "a".repeat(64),
  );
  await client.getRun(run.runUid);

  assert.equal(requests[0]?.url, "https://steward.example.test/control/v1/runs");
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer token-1");
  assert.equal(requests[0]?.headers.get("idempotency-key"), "a".repeat(64));
  assert.equal(requests[1]?.headers.get("authorization"), "Bearer token-2");
});

test("the Steward client retries transient responses and honors Retry-After", async () => {
  const delays: number[] = [];
  let calls = 0;
  const client = new StewardClient({
    baseUrl: "https://steward.example.test",
    getToken: async () => "token",
    fetch: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ message: "temporary" }, 503, { "retry-after": "2" })
        : jsonResponse(run);
    },
    sleep: async (milliseconds) => void delays.push(milliseconds),
  });
  assert.deepEqual(await client.getRun(run.runUid), run);
  assert.deepEqual(delays, [2_000]);
});

test("input upload retries recreate the archive stream", async () => {
  let requests = 0;
  let archives = 0;
  const client = new StewardClient({
    baseUrl: "https://steward.example.test",
    getToken: async () => "token",
    fetch: async (_input, init) => {
      requests += 1;
      for await (const _chunk of init?.body as unknown as Readable) {
        // Consume the one-shot stream as a real fetch implementation does.
      }
      return new Response(null, { status: requests === 1 ? 503 : 204 });
    },
    sleep: async () => undefined,
  });
  await client.uploadInputs(run.runUid, async () => {
    archives += 1;
    return Readable.from("archive");
  });
  assert.equal(archives, 2);
});

test("the Steward client fails closed on incompatible payloads and unsafe base URLs", async () => {
  assert.throws(
    () =>
      new StewardClient({
        baseUrl: "http://steward.example.test",
        getToken: async () => "token",
        fetch,
      }),
    /HTTPS/,
  );
  const client = new StewardClient({
    baseUrl: "https://steward.example.test",
    getToken: async () => "token",
    fetch: async () => jsonResponse({ ...run, phase: "surprise" }),
    sleep: async () => undefined,
  });
  await assert.rejects(client.getRun(run.runUid), /incompatible run response/);
});
