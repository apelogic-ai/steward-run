import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { getGitHubOidcToken } from "../src/oidc.ts";
import {
  StewardClient,
  StewardRequestFailure,
  type Task,
} from "../src/steward-client.ts";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const task: Task = {
  taskUid: "2f9f6ade-261d-4090-9532-9e157b59db2e",
  runtimeUid: "runtime-uid-1",
  phase: "submitted",
  runtimeOwnership: "provisioned",
  finalized: false,
  deltas: [],
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

test("the Steward client submits Tasks with fresh OIDC tokens and an idempotency key", async () => {
  let tokenNumber = 0;
  const requests: Request[] = [];
  const client = new StewardClient({
    baseUrl: "https://steward.example.test/control/",
    getToken: async () => `token-${++tokenNumber}`,
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return jsonResponse(task, requests.length === 1 ? 201 : 200);
    },
    sleep: async () => undefined,
  });

  await client.submitTask(
    { workflow: "cve-triage", codingAgentRuntime: "claude-code@2.1.220" },
    "a".repeat(64),
  );
  await client.getTask(task.taskUid);

  assert.equal(requests[0]?.url, "https://steward.example.test/control/v1/tasks");
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer token-1");
  assert.equal(requests[0]?.headers.get("idempotency-key"), "a".repeat(64));
  assert.equal(requests[1]?.headers.get("authorization"), "Bearer token-2");
});

test("Task submission accepts admitted and parked responses with structured deltas", async () => {
  const responses = [
    jsonResponse(task, 201),
    jsonResponse(
      {
        ...task,
        phase: "parked",
        deltas: [
          {
            dimension: "budget",
            requested: "20.00",
            ceiling: "10.00",
            currency: "USD",
          },
        ],
      },
      202,
    ),
  ];
  const client = new StewardClient({
    baseUrl: "https://steward.example.test",
    getToken: async () => "token",
    fetch: async () => responses.shift() ?? jsonResponse(task),
  });

  assert.equal(
    (await client.submitTask({ workflow: "code-review", codingAgentRuntime: "base" }, "a".repeat(64)))
      .phase,
    "submitted",
  );
  assert.deepEqual(
    await client.submitTask({ workflow: "wide-review", codingAgentRuntime: "base" }, "b".repeat(64)),
    {
      ...task,
      phase: "parked",
      deltas: [
        {
          dimension: "budget",
          requested: "20.00",
          ceiling: "10.00",
          currency: "USD",
        },
      ],
    },
  );
});

test("Task submission accepts only documented non-final pending runtime binding states", async () => {
  const pending = ["submitted", "parked", "queued"].map((phase) => ({
    ...task,
    runtimeUid: null,
    phase,
  }));
  const responses = pending.map((response) => jsonResponse(response, 202));
  const client = new StewardClient({
    baseUrl: "https://steward.example.test",
    getToken: async () => "token",
    fetch: async () => responses.shift() ?? jsonResponse(task),
  });

  for (const expected of pending) {
    assert.deepEqual(
      await client.submitTask(
        { workflow: "code-review", codingAgentRuntime: "base" },
        "a".repeat(64),
      ),
      expected,
    );
  }
});

test("pending runtime binding fails closed on null misuse and response contradictions", async () => {
  const privateToken = "private-binding-bearer";
  const privateBody = "private-binding-response";
  const incompatible = [
    { ...task, runtimeUid: "" },
    { ...task, runtimeUid: 7 },
    { ...task, runtimeUid: null, phase: "running" },
    { ...task, runtimeUid: null, phase: "succeeded" },
    { ...task, runtimeUid: null, finalized: true },
    { ...task, runtimeUid: null, runtimeOwnership: "adopted" },
    { ...task, runtimeUid: null, failureReason: privateBody },
    { ...task, runtimeUid: null, unknown: privateBody },
  ];

  for (const payload of incompatible) {
    const client = new StewardClient({
      baseUrl: "https://steward.example.test",
      getToken: async () => privateToken,
      fetch: async () => jsonResponse(payload, 202),
      maxAttempts: 1,
    });
    await assert.rejects(
      client.submitTask(
        { workflow: "code-review", codingAgentRuntime: "base" },
        "a".repeat(64),
      ),
      (error: unknown) => {
        assert.ok(error instanceof StewardRequestFailure);
        assert.equal(error.stage, "submit");
        assert.equal(error.category, "malformed-response");
        assert.doesNotMatch(error.message, /private-binding/u);
        return true;
      },
    );
  }
});

test("pending-binding polling never discloses bearer tokens or malformed bodies", async () => {
  const privateToken = "private-poll-bearer";
  const privateBody = "private-poll-body";
  const responses = [
    jsonResponse({ ...task, runtimeUid: null }, 202),
    jsonResponse({ ...task, runtimeUid: null, phase: "running", privateBody }, 200),
  ];
  const client = new StewardClient({
    baseUrl: "https://steward.example.test",
    getToken: async () => privateToken,
    fetch: async () => responses.shift() ?? jsonResponse(task),
    maxAttempts: 1,
  });

  const pending = await client.submitTask(
    { workflow: "code-review", codingAgentRuntime: "base" },
    "a".repeat(64),
  );
  assert.equal(pending.runtimeUid, null);
  await assert.rejects(client.getTask(pending.taskUid), (error: unknown) => {
    assert.ok(error instanceof StewardRequestFailure);
    assert.equal(error.stage, "poll");
    assert.equal(error.category, "malformed-response");
    assert.doesNotMatch(error.message, /private-poll/u);
    return true;
  });
});

test("pending runtime binding is restricted to compatible response operations", async () => {
  for (const [operation, status] of [["submit", 201], ["execute", 202]] as const) {
    const client = new StewardClient({
      baseUrl: "https://steward.example.test",
      getToken: async () => "private-operation-bearer",
      fetch: async () => jsonResponse({ ...task, runtimeUid: null }, status),
      maxAttempts: 1,
    });
    const request = operation === "submit"
      ? client.submitTask(
        { workflow: "code-review", codingAgentRuntime: "base" },
        "a".repeat(64),
      )
      : client.executeTask(task.taskUid);
    await assert.rejects(request, (error: unknown) => {
      assert.ok(error instanceof StewardRequestFailure);
      assert.equal(error.stage, operation);
      assert.equal(error.category, "malformed-response");
      assert.doesNotMatch(error.message, /private-operation/u);
      return true;
    });
  }
});

test("Task submission preserves bounded HTTP failure classification", async (context) => {
  for (const [status, category] of [
    [400, "validation"],
    [422, "validation"],
    [401, "authentication"],
    [403, "authorization"],
    [409, "conflict"],
    [503, "dependency"],
  ] as const) {
    await context.test(`${status} is ${category}`, async () => {
      const secretBody = `private-response-${status}`;
      const client = new StewardClient({
        baseUrl: "https://steward.example.test",
        getToken: async () => "private-bearer-token",
        fetch: async () =>
          new Response(secretBody, {
            status,
            headers: {
              "content-type": "application/json",
              "x-request-id": `request-${status}`,
            },
          }),
        maxAttempts: 1,
      });

      await assert.rejects(
        client.submitTask(
          { workflow: "code-review", codingAgentRuntime: "base" },
          "a".repeat(64),
        ),
        (error: unknown) => {
          assert.ok(error instanceof StewardRequestFailure);
          assert.equal(error.stage, "submit");
          assert.equal(error.category, category);
          assert.equal(error.httpStatus, status);
          assert.equal(error.correlationId, `request-${status}`);
          assert.doesNotMatch(error.message, /private-response|private-bearer-token/u);
          return true;
        },
      );
    });
  }
});

test("Task submission rejects malformed successful responses without exposing their body", async () => {
  const secretBody = "private-malformed-response";
  const client = new StewardClient({
    baseUrl: "https://steward.example.test",
    getToken: async () => "private-bearer-token",
    fetch: async () =>
      jsonResponse(secretBody, 201, { "x-correlation-id": "correlation-malformed" }),
  });

  await assert.rejects(
    client.submitTask({ workflow: "code-review", codingAgentRuntime: "base" }, "a".repeat(64)),
    (error: unknown) => {
      assert.ok(error instanceof StewardRequestFailure);
      assert.equal(error.stage, "submit");
      assert.equal(error.category, "malformed-response");
      assert.equal(error.httpStatus, 201);
      assert.equal(error.correlationId, "correlation-malformed");
      assert.doesNotMatch(error.message, /private-malformed-response|private-bearer-token/u);
      return true;
    },
  );
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
        : jsonResponse(task);
    },
    sleep: async (milliseconds) => void delays.push(milliseconds),
  });
  assert.deepEqual(await client.getTask(task.taskUid), task);
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
  await client.uploadTaskInputs(task.taskUid, async () => {
    archives += 1;
    return Readable.from("archive");
  });
  assert.equal(archives, 2);
});

test("timeout and transport failures remain distinct and bounded", async (context) => {
  for (const [code, category] of [
    ["ETIMEDOUT", "timeout"],
    ["ECONNRESET", "transport"],
  ] as const) {
    await context.test(category, async () => {
      const secret = `not-for-${category}-output`;
      const client = new StewardClient({
        baseUrl: "https://steward.example.test",
        getToken: async () => "token",
        fetch: async () => {
          throw Object.assign(new Error(secret), { code });
        },
        maxAttempts: 1,
      });
      await assert.rejects(client.getTask(task.taskUid), (error: unknown) => {
        assert.ok(error instanceof StewardRequestFailure);
        assert.equal(error.stage, "poll");
        assert.equal(error.category, category);
        assert.equal(error.httpStatus, undefined);
        assert.equal(error.correlationId, undefined);
        assert.doesNotMatch(error.message, new RegExp(secret, "u"));
        return true;
      });
    });
  }
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
    fetch: async () => jsonResponse({ ...task, phase: "surprise" }),
    sleep: async () => undefined,
  });
  await assert.rejects(client.getTask(task.taskUid), (error: unknown) => {
    assert.ok(error instanceof StewardRequestFailure);
    assert.equal(error.stage, "poll");
    assert.equal(error.category, "malformed-response");
    return true;
  });
});
