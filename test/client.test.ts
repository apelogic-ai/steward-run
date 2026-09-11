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

const directTaskStatus = {
  ...task,
  contractVersion: "steward.task/v2" as const,
  diagnostics: { executionLog: "full" as const },
  evidence: {
    schemaVersion: "steward.task/source-authority-evidence/v1",
    taskUid: task.taskUid,
    sourceProvenance: {
      contractVersion: "steward.source-provenance/v1",
      provider: "github",
      repository: { id: "123456", ownerId: "7890", name: "example-org/caller" },
      triggeredSha: `git:sha1:${"c".repeat(40)}`,
      run: { id: "900001", attempt: 1 },
      event: "workflow_dispatch",
      ref: "refs/heads/main",
      actorId: "24680",
      actor: "alice",
      callerWorkflow: {
        ref: "example-org/caller/.github/workflows/review.yml@refs/heads/main",
        sha: `git:sha1:${"d".repeat(40)}`,
      },
      reusableWorkflow: {
        ref: "example-org/steward-run/.github/workflows/steward-task.yml@refs/tags/v1.0.0",
        sha: `git:sha1:${"e".repeat(40)}`,
      },
    },
    invocation: {
      repository: "https://github.com/example-org/caller.git",
      repositoryId: "123456",
      repositoryOwnerId: "7890",
      commit: `git:sha1:${"c".repeat(40)}`,
      path: ".steward/tasks/release-summary.json",
      contentDigest: `steward:sha256:${"3".repeat(64)}`,
    },
    package: {
      repository: "https://github.com/example-org/agentic-ops.git",
      repositoryId: "654321",
      repositoryOwnerId: "7890",
      commit: `git:sha1:${"a".repeat(40)}`,
      path: "catalog/release-summary/v1/task-definition.json",
      contentDigest: `steward:sha256:${"1".repeat(64)}`,
    },
    closure: {
      contractVersion: "steward.package-closure/v1",
      entryPoint: "catalog/release-summary/v1/task-definition.json",
      entries: [
        {
          kind: "prompt",
          path: "catalog/release-summary/v1/prompt.md",
          digest: `steward:sha256:${"2".repeat(64)}`,
          sizeBytes: 1200,
        },
        {
          kind: "task_definition",
          path: "catalog/release-summary/v1/task-definition.json",
          digest: `steward:sha256:${"1".repeat(64)}`,
          sizeBytes: 301,
        },
      ],
    },
    closureDigest: "steward:sha256:82bac7f1c28cc851e94be8bc10e9dfe563f5c940eb5e979edb91fc84fd0d0ef4",
    envelope: {
      uid: "22222222-2222-4222-8222-222222222222",
      revision: 3,
      digest: `steward:sha256:${"b".repeat(64)}`,
    },
    effectiveRequirements: {
      authority: {
        llms: [{ provider: "litellm", model: "review-model" }],
        tools: [{ provider: "github", resource: "actions", action: "read" }],
        budget: {
          monthlyLimit: "50.00",
          singleRunLimit: null,
          currency: "USD",
        },
        ttl: "1h",
        runner: {
          platforms: ["linux"],
          memory: null,
          compute: null,
          storage: null,
        },
      },
    },
    diagnostics: { executionLog: "full" as const },
  },
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

  await client.submitTask({ workflow: "repository-review@1" }, "a".repeat(64));
  await client.getTask(task.taskUid);

  assert.equal(requests[0]?.url, "https://steward.example.test/control/v1/tasks");
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer token-1");
  assert.equal(requests[0]?.headers.get("idempotency-key"), "a".repeat(64));
  assert.deepEqual(await requests[0]?.json(), { workflow: "repository-review@1" });
  assert.equal(requests[1]?.headers.get("authorization"), "Bearer token-2");
});

test("direct-package submission accepts Steward's complete v2 Task status", async () => {
  let request: Request | undefined;
  const client = new StewardClient({
    baseUrl: "https://steward.example.test",
    getToken: async () => "token",
    fetch: async (input, init) => {
      request = new Request(input, init);
      return jsonResponse(directTaskStatus, 201);
    },
  });

  const created = await client.submitTask(
    {
      contractVersion: "steward.task/v2",
      invocationPath: ".steward/tasks/release-summary.json",
    },
    "a".repeat(64),
  );

  assert.deepEqual(await request?.json(), {
    contractVersion: "steward.task/v2",
    invocationPath: ".steward/tasks/release-summary.json",
  });
  assert.deepEqual(created.diagnostics, { executionLog: "full" });
  assert.equal(created.contractVersion, "steward.task/v2");
});

test("direct Task status requires an exact authenticated diagnostics projection", async () => {
  for (const payload of [
    { ...task, contractVersion: "steward.task/v2" },
    { ...task, diagnostics: { executionLog: "full" } },
    {
      ...task,
      contractVersion: "steward.task/v2",
      diagnostics: { executionLog: "verbose" },
    },
    {
      ...task,
      contractVersion: "steward.task/v2",
      diagnostics: { executionLog: "full", unknown: true },
    },
  ]) {
    const client = new StewardClient({
      baseUrl: "https://steward.example.test",
      getToken: async () => "token",
      fetch: async () => jsonResponse(payload, 201),
      maxAttempts: 1,
    });
    await assert.rejects(
      client.submitTask(
        {
          contractVersion: "steward.task/v2",
          invocationPath: ".steward/tasks/release-summary.json",
        },
        "a".repeat(64),
      ),
      (error: unknown) => {
        assert.ok(error instanceof StewardRequestFailure);
        assert.equal(error.category, "malformed-response");
        return true;
      },
    );
  }
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
    (await client.submitTask({ workflow: "code-review@1" }, "a".repeat(64)))
      .phase,
    "submitted",
  );
  assert.deepEqual(
    await client.submitTask({ workflow: "wide-review@1" }, "b".repeat(64)),
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
        { workflow: "code-review@1" },
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
    { ...task, runtimeUid: null, phase: "cancelled", failureReason: privateBody },
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
        { workflow: "code-review@1" },
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

test("unbound cancellation and finalization preserve the real Steward response shape", async () => {
  const cancelled = { ...task, runtimeUid: null, phase: "cancelled" as const };
  const finalized = { ...cancelled, finalized: true };
  const responses = [jsonResponse(cancelled, 202), jsonResponse(finalized, 200)];
  const client = new StewardClient({
    baseUrl: "https://steward.example.test",
    getToken: async () => "token",
    fetch: async () => responses.shift() ?? jsonResponse(finalized),
    maxAttempts: 1,
  });

  assert.deepEqual(await client.finalizeTask(task.taskUid), cancelled);
  assert.deepEqual(await client.getTask(task.taskUid), finalized);
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
    { workflow: "code-review@1" },
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
  const pending = { ...task, runtimeUid: null };
  const cancelled = { ...pending, phase: "cancelled" };
  for (const [operation, status, payload] of [
    ["submit", 201, pending],
    ["submit", 202, cancelled],
    ["execute", 202, pending],
    ["finalize", 202, pending],
  ] as const) {
    const client = new StewardClient({
      baseUrl: "https://steward.example.test",
      getToken: async () => "private-operation-bearer",
      fetch: async () => jsonResponse(payload, status),
      maxAttempts: 1,
    });
    const request = operation === "submit"
      ? client.submitTask(
        { workflow: "code-review@1" },
        "a".repeat(64),
      )
      : operation === "execute"
        ? client.executeTask(task.taskUid)
        : client.finalizeTask(task.taskUid);
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
          { workflow: "code-review@1" },
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
    client.submitTask({ workflow: "code-review@1" }, "a".repeat(64)),
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

test("binding GET cancellation bounds never-resolving token and fetch operations", async (context) => {
  for (const stalled of ["token", "fetch"] as const) {
    await context.test(stalled, async () => {
      const controller = new AbortController();
      let observedSignal: AbortSignal | undefined;
      const client = new StewardClient({
        baseUrl: "https://steward.example.test",
        getToken: async (signal) => {
          if (stalled === "token") {
            observedSignal = signal;
            return new Promise<string>(() => undefined);
          }
          return "token";
        },
        fetch: async (_input, init) => {
          if (stalled === "fetch") {
            observedSignal = init?.signal ?? undefined;
            return new Promise<Response>(() => undefined);
          }
          return jsonResponse(task);
        },
        maxAttempts: 1,
      });
      const cancellation = setTimeout(() => controller.abort(), 10);
      try {
        await assert.rejects(
          client.getTask(task.taskUid, { signal: controller.signal }),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.equal(error.name, "AbortError");
            assert.doesNotMatch(error.message, /token|response-body/u);
            return true;
          },
        );
        assert.equal(observedSignal?.aborted, true);
      } finally {
        clearTimeout(cancellation);
      }
    });
  }
});

test("binding GET deadline bounds never-resolving token and fetch operations", async (context) => {
  for (const stalled of ["token", "fetch"] as const) {
    await context.test(stalled, async () => {
      let observedSignal: AbortSignal | undefined;
      const client = new StewardClient({
        baseUrl: "https://steward.example.test",
        getToken: async (signal) => {
          if (stalled === "token") {
            observedSignal = signal;
            return new Promise<string>(() => undefined);
          }
          return "token";
        },
        fetch: async (_input, init) => {
          if (stalled === "fetch") {
            observedSignal = init?.signal ?? undefined;
            return new Promise<Response>(() => undefined);
          }
          return jsonResponse(task);
        },
        maxAttempts: 1,
      });
      await assert.rejects(
        client.getTask(task.taskUid, { deadline: Date.now() + 10 }),
        (error: unknown) => {
          assert.ok(error instanceof StewardRequestFailure);
          assert.equal(error.stage, "poll");
          assert.equal(error.category, "timeout");
          assert.equal(error.httpStatus, undefined);
          assert.equal(error.correlationId, undefined);
          return true;
        },
      );
      assert.equal(observedSignal?.aborted, true);
    });
  }
});

test("binding GET deadline bounds and cancels a never-ending JSON response body", async () => {
  let bodyCancelled = false;
  const client = new StewardClient({
    baseUrl: "https://steward.example.test",
    getToken: async () => "token",
    fetch: async (_input, _init) => {
      return new Response(
        new ReadableStream<Uint8Array>({
          cancel: () => void (bodyCancelled = true),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    maxAttempts: 1,
  });

  await assert.rejects(
    client.getTask(task.taskUid, { deadline: Date.now() + 10 }),
    (error: unknown) => {
      assert.ok(error instanceof StewardRequestFailure);
      assert.equal(error.stage, "poll");
      assert.equal(error.category, "timeout");
      assert.equal(error.httpStatus, undefined);
      assert.equal(error.correlationId, undefined);
      return true;
    },
  );
  assert.equal(bodyCancelled, true);
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
