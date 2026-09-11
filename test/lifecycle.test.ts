import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import tar from "tar-stream";
import type { WorkflowConfig } from "../src/config.ts";
import { StewardRunFailure } from "../src/failure-metadata.ts";
import {
  createIdempotencyKey,
  runWorkflow,
  type TaskClient,
} from "../src/lifecycle.ts";
import {
  StewardClient,
  StewardRequestFailure,
  type Task,
  type TaskSubmissionRequest,
} from "../src/steward-client.ts";

const baseTask: Task = {
  taskUid: "2f9f6ade-261d-4090-9532-9e157b59db2e",
  runtimeUid: "runtime-uid-1",
  phase: "submitted",
  runtimeOwnership: "provisioned",
  finalized: false,
  deltas: [],
};

const config: WorkflowConfig = {
  workflow: "repository-review@1",
  inputPaths: "in",
  outputPaths: "results",
  apiUrl: "https://steward.example.test",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function outputArchive(path = "results/report.txt", body = "done"): Promise<Readable> {
  const pack = tar.pack();
  pack.entry({ name: path }, body);
  pack.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of pack) chunks.push(Buffer.from(chunk));
  return Readable.from(Buffer.concat(chunks));
}

class FakeClient implements TaskClient {
  readonly calls: string[] = [];
  readonly requests: TaskSubmissionRequest[] = [];
  phases: Task["phase"][] = ["running", "succeeded"];
  ownership: Task["runtimeOwnership"] = "provisioned";
  archivePath = "results/report.txt";
  failureReason?: string;
  finalizeError?: Error;
  submittedTask: Task = baseTask;
  bindingTasks: Task[] = [];
  executingTask: Task = { ...baseTask, phase: "running" };
  finalizingTasks: Task[] = [];
  finalizationStarted = false;
  ignoreBindingCancellation = false;

  async submitTask(request: TaskSubmissionRequest): Promise<Task> {
    this.calls.push("create");
    this.requests.push(request);
    return { ...this.submittedTask, runtimeOwnership: this.ownership };
  }
  async uploadTaskInputs(_uid: string, createArchive: () => Promise<Readable>): Promise<void> {
    this.calls.push("upload");
    for await (const _chunk of await createArchive()) {
      // Exercise the real input stream.
    }
  }
  async executeTask(): Promise<Task> {
    this.calls.push("execute");
    return { ...this.executingTask, runtimeOwnership: this.ownership };
  }
  async getTask(): Promise<Task> {
    this.calls.push("poll");
    if (this.finalizationStarted) {
      const finalizingTask = this.finalizingTasks.shift();
      if (finalizingTask) return { ...finalizingTask, runtimeOwnership: this.ownership };
    }
    if (this.ignoreBindingCancellation) return new Promise<Task>(() => undefined);
    const bindingTask = this.bindingTasks.shift();
    if (bindingTask) return { ...bindingTask, runtimeOwnership: this.ownership };
    return {
      ...baseTask,
      phase: this.phases.shift() ?? "succeeded",
      runtimeOwnership: this.ownership,
      ...(this.failureReason === undefined ? {} : { failureReason: this.failureReason }),
    };
  }
  async downloadTaskOutputs(): Promise<Readable> {
    this.calls.push("download");
    return outputArchive(this.archivePath);
  }
  async finalizeTask(): Promise<Task> {
    this.calls.push("finalize");
    if (this.finalizeError) throw this.finalizeError;
    this.finalizationStarted = true;
    const finalizingTask = this.finalizingTasks.shift();
    if (finalizingTask) return { ...finalizingTask, runtimeOwnership: this.ownership };
    return { ...baseTask, phase: "cancelled", runtimeOwnership: this.ownership, finalized: true };
  }
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "steward-run-lifecycle-"));
  await mkdir(join(root, "in"));
  await writeFile(join(root, "in", "request.txt"), "work");
  return root;
}

function dependencies(client: TaskClient, outputs: Record<string, string>) {
  return {
    client,
    environment: {
      GITHUB_REPOSITORY: "apelogic-ai/example",
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_JOB: "agent",
    },
    setOutput: async (name: string, value: string) => void (outputs[name] = value),
    sleep: async () => undefined,
  };
}

test("a provisioned Task round-trips files, reports identities, and finalizes", async () => {
  const root = await fixture();
  const client = new FakeClient();
  const outputs: Record<string, string> = {};
  try {
    const result = await runWorkflow(config, root, dependencies(client, outputs));
    assert.equal(result.phase, "succeeded");
    assert.equal(await readFile(join(root, "results", "report.txt"), "utf8"), "done");
    assert.deepEqual(outputs, {
      status: "succeeded",
      "task-uid": baseTask.taskUid,
      "runtime-uid": "runtime-uid-1",
    });
    assert.deepEqual(client.requests, [{ workflow: "repository-review@1" }]);
    assert.deepEqual(client.calls, ["create", "upload", "execute", "poll", "poll", "download", "finalize"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a pending Task binds before runtime output, upload, and execution", async () => {
  const root = await fixture();
  const client = new FakeClient();
  client.submittedTask = { ...baseTask, runtimeUid: null };
  client.bindingTasks = [
    { ...baseTask, runtimeUid: null, phase: "queued" },
    { ...baseTask, phase: "submitted" },
  ];
  const outputs: Record<string, string> = {};
  const pendingDependencies = dependencies(client, outputs);
  pendingDependencies.setOutput = async (name: string, value: string) => {
    client.calls.push(`output:${name}`);
    outputs[name] = value;
  };
  try {
    const result = await runWorkflow(config, root, pendingDependencies);
    assert.equal(result.phase, "succeeded");
    assert.deepEqual(client.calls, [
      "create",
      "output:task-uid",
      "poll",
      "poll",
      "output:runtime-uid",
      "upload",
      "execute",
      "poll",
      "poll",
      "output:status",
      "download",
      "finalize",
    ]);
    assert.equal(outputs["runtime-uid"], baseTask.runtimeUid);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Task runtime ownership must match provision or adoption intent", async () => {
  for (const [agentRuntime, ownership] of [
    [undefined, "adopted"],
    ["standing-runtime", "provisioned"],
  ] as const) {
    const root = await fixture();
    const client = new FakeClient();
    client.ownership = ownership;
    const outputs: Record<string, string> = {};
    try {
      await assert.rejects(
        runWorkflow(
          { ...config, ...(agentRuntime === undefined ? {} : { agentRuntime }) },
          root,
          dependencies(client, outputs),
        ),
        (error) => {
          assert.ok(error instanceof StewardRunFailure);
          assert.equal(error.metadata.failureCategory, "dependency");
          assert.equal(error.metadata.cleanupCategory, "confirmed");
          return true;
        },
      );
      assert.equal(outputs["task-uid"], undefined);
      assert.equal(client.calls.includes("upload"), false);
      assert.equal(client.calls.includes("execute"), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("runtime binding rejects a changed Task UID before upload or execution", async () => {
  const root = await fixture();
  const client = new FakeClient();
  client.submittedTask = { ...baseTask, runtimeUid: null };
  client.bindingTasks = [
    {
      ...baseTask,
      taskUid: "d296d3b4-b25f-4e78-a0c5-6fc637cf69cc",
    },
  ];
  const outputs: Record<string, string> = {};
  try {
    await assert.rejects(runWorkflow(config, root, dependencies(client, outputs)), (error) => {
      assert.ok(error instanceof StewardRunFailure);
      assert.equal(error.metadata.failureCategory, "dependency");
      assert.equal(error.metadata.cleanupCategory, "confirmed");
      return true;
    });
    assert.equal(outputs["runtime-uid"], undefined);
    assert.equal(client.calls.includes("upload"), false);
    assert.equal(client.calls.includes("execute"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a runtime UID cannot change after the first binding", async () => {
  const root = await fixture();
  const client = new FakeClient();
  client.submittedTask = { ...baseTask, runtimeUid: null };
  client.bindingTasks = [{ ...baseTask }];
  client.executingTask = { ...baseTask, runtimeUid: "runtime-uid-rebound", phase: "running" };
  const outputs: Record<string, string> = {};
  try {
    await assert.rejects(runWorkflow(config, root, dependencies(client, outputs)), (error) => {
      assert.ok(error instanceof StewardRunFailure);
      assert.equal(error.metadata.failureCategory, "execution");
      assert.equal(error.metadata.cleanupCategory, "confirmed");
      assert.doesNotMatch(error.message, /runtime-uid-rebound/u);
      return true;
    });
    assert.equal(outputs["runtime-uid"], baseTask.runtimeUid);
    assert.equal(client.calls.includes("execute"), true);
    assert.equal(client.calls.includes("download"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime binding timeout is bounded, classified, and does not expose runtime state", async () => {
  const root = await fixture();
  const client = new FakeClient();
  client.submittedTask = { ...baseTask, runtimeUid: null };
  client.bindingTasks = Array.from({ length: 60 }, () => ({
    ...baseTask,
    runtimeUid: null,
    phase: "queued",
  }));
  client.finalizingTasks = [
    { ...baseTask, runtimeUid: null, phase: "cancelled" },
    { ...baseTask, runtimeUid: null, phase: "cancelled", finalized: true },
  ];
  const outputs: Record<string, string> = {};
  try {
    await assert.rejects(runWorkflow(config, root, dependencies(client, outputs)), (error) => {
      assert.ok(error instanceof StewardRunFailure);
      assert.deepEqual(error.metadata, {
        version: "steward-run.failure/v1",
        phase: "unavailable",
        failureCategory: "timeout",
        cleanupCategory: "confirmed",
        requestStage: "poll",
      });
      assert.doesNotMatch(error.message, /runtime-uid-1/u);
      return true;
    });
    const finalizeIndex = client.calls.indexOf("finalize");
    assert.equal(client.calls.slice(0, finalizeIndex).filter((call) => call === "poll").length, 60);
    assert.deepEqual(client.calls.slice(finalizeIndex), ["finalize", "poll"]);
    assert.equal(outputs["runtime-uid"], undefined);
    assert.equal(client.calls.includes("upload"), false);
    assert.equal(client.calls.includes("execute"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime binding cancellation is bounded and remains fail closed", async () => {
  const root = await fixture();
  const client = new FakeClient();
  client.submittedTask = { ...baseTask, runtimeUid: null };
  client.finalizingTasks = [
    { ...baseTask, runtimeUid: null, phase: "cancelled" },
    { ...baseTask, runtimeUid: null, phase: "cancelled", finalized: true },
  ];
  const controller = new AbortController();
  const outputs: Record<string, string> = {};
  const cancelledDependencies = {
    ...dependencies(client, outputs),
    signal: controller.signal,
    sleep: async () => void controller.abort(),
  };
  try {
    await assert.rejects(runWorkflow(config, root, cancelledDependencies), (error) => {
      assert.ok(error instanceof StewardRunFailure);
      assert.equal(error.metadata.phase, "cancelled");
      assert.equal(error.metadata.failureCategory, "cancelled");
      assert.equal(error.metadata.cleanupCategory, "confirmed");
      return true;
    });
    assert.equal(outputs["runtime-uid"], undefined);
    assert.deepEqual(client.calls, ["create", "finalize", "poll"]);
    assert.equal(client.calls.includes("upload"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("server cancellation while waiting for binding finalizes without inventing a runtime UID", async () => {
  const root = await fixture();
  const client = new FakeClient();
  client.submittedTask = { ...baseTask, runtimeUid: null };
  client.bindingTasks = [{ ...baseTask, runtimeUid: null, phase: "cancelled" }];
  client.finalizingTasks = [
    { ...baseTask, runtimeUid: null, phase: "cancelled" },
    { ...baseTask, runtimeUid: null, phase: "cancelled", finalized: true },
  ];
  const outputs: Record<string, string> = {};
  try {
    await assert.rejects(runWorkflow(config, root, dependencies(client, outputs)), (error) => {
      assert.ok(error instanceof StewardRunFailure);
      assert.deepEqual(error.metadata, {
        version: "steward-run.failure/v1",
        phase: "cancelled",
        failureCategory: "cancelled",
        cleanupCategory: "confirmed",
      });
      return true;
    });
    assert.equal(outputs.status, "cancelled");
    assert.equal(outputs["runtime-uid"], undefined);
    assert.deepEqual(client.calls, ["create", "poll", "finalize", "poll"]);
    assert.equal(client.calls.includes("upload"), false);
    assert.equal(client.calls.includes("execute"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("binding deadline interrupts a never-resolving Steward GET and confirms unbound cleanup", async () => {
  const root = await fixture();
  let finalizing = false;
  let bindingSignal: AbortSignal | undefined;
  const pending = { ...baseTask, runtimeUid: null };
  const cancelled = { ...pending, phase: "cancelled" as const };
  const client = new StewardClient({
    baseUrl: "https://steward.example.test",
    getToken: async () => "token",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "POST" && request.url.endsWith("/v1/tasks")) {
        return jsonResponse(pending, 202);
      }
      if (request.method === "DELETE") {
        finalizing = true;
        return jsonResponse(cancelled, 202);
      }
      if (request.method === "GET" && finalizing) {
        return jsonResponse({ ...cancelled, finalized: true });
      }
      if (request.method === "GET") {
        bindingSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }
      throw new Error("unexpected Steward test request");
    },
    maxAttempts: 1,
  });
  const outputs: Record<string, string> = {};
  try {
    await assert.rejects(
      runWorkflow(config, root, {
        ...dependencies(client, outputs),
        runtimeBindingTimeoutMilliseconds: 10,
        sleep: async () => undefined,
      }),
      (error) => {
        assert.ok(error instanceof StewardRunFailure);
        assert.deepEqual(error.metadata, {
          version: "steward-run.failure/v1",
          phase: "unavailable",
          failureCategory: "timeout",
          cleanupCategory: "confirmed",
          requestStage: "poll",
        });
        return true;
      },
    );
    assert.equal(bindingSignal?.aborted, true);
    assert.equal(outputs["runtime-uid"], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("binding deadline also bounds a non-cooperative TaskClient GET", async () => {
  const root = await fixture();
  const client = new FakeClient();
  client.submittedTask = { ...baseTask, runtimeUid: null };
  client.ignoreBindingCancellation = true;
  client.finalizingTasks = [
    { ...baseTask, runtimeUid: null, phase: "cancelled" },
    { ...baseTask, runtimeUid: null, phase: "cancelled", finalized: true },
  ];
  const outputs: Record<string, string> = {};
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    const guarded = Promise.race([
      runWorkflow(config, root, {
        ...dependencies(client, outputs),
        runtimeBindingTimeoutMilliseconds: 10,
        sleep: async () => undefined,
      }),
      new Promise<Task>((_resolve, reject) => {
        guard = setTimeout(
          () => reject(new Error("non-cooperative TaskClient exceeded binding deadline")),
          250,
        );
      }),
    ]);
    await assert.rejects(guarded, (error) => {
      assert.ok(error instanceof StewardRunFailure);
      assert.deepEqual(error.metadata, {
        version: "steward-run.failure/v1",
        phase: "unavailable",
        failureCategory: "timeout",
        cleanupCategory: "confirmed",
        requestStage: "poll",
      });
      return true;
    });
    assert.equal(outputs["runtime-uid"], undefined);
    assert.deepEqual(client.calls, ["create", "poll", "finalize", "poll"]);
  } finally {
    if (guard !== undefined) clearTimeout(guard);
    await rm(root, { recursive: true, force: true });
  }
});

test("binding cancellation interrupts a never-resolving token provider and confirms cleanup", async () => {
  const root = await fixture();
  let tokenRequests = 0;
  let stalledTokenSignal: AbortSignal | undefined;
  let finalizing = false;
  const pending = { ...baseTask, runtimeUid: null };
  const cancelled = { ...pending, phase: "cancelled" as const };
  const client = new StewardClient({
    baseUrl: "https://steward.example.test",
    getToken: async (signal) => {
      tokenRequests += 1;
      if (tokenRequests === 2) {
        stalledTokenSignal = signal;
        return new Promise<string>(() => undefined);
      }
      return "token";
    },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "POST" && request.url.endsWith("/v1/tasks")) {
        return jsonResponse(pending, 202);
      }
      if (request.method === "DELETE") {
        finalizing = true;
        return jsonResponse(cancelled, 202);
      }
      if (request.method === "GET" && finalizing) {
        return jsonResponse({ ...cancelled, finalized: true });
      }
      throw new Error("binding GET must not reach fetch while its token is stalled");
    },
    maxAttempts: 1,
  });
  const controller = new AbortController();
  const cancellation = setTimeout(() => controller.abort(), 10);
  const outputs: Record<string, string> = {};
  try {
    await assert.rejects(
      runWorkflow(config, root, {
        ...dependencies(client, outputs),
        signal: controller.signal,
        sleep: async () => undefined,
      }),
      (error) => {
        assert.ok(error instanceof StewardRunFailure);
        assert.deepEqual(error.metadata, {
          version: "steward-run.failure/v1",
          phase: "cancelled",
          failureCategory: "cancelled",
          cleanupCategory: "confirmed",
        });
        return true;
      },
    );
    assert.equal(stalledTokenSignal?.aborted, true);
    assert.equal(outputs.status, "cancelled");
    assert.equal(outputs["runtime-uid"], undefined);
  } finally {
    clearTimeout(cancellation);
    await rm(root, { recursive: true, force: true });
  }
});

test("adoption is explicit and a parked Task waits for approval before collecting outputs", async () => {
  const root = await fixture();
  const client = new FakeClient();
  client.ownership = "adopted";
  client.phases = ["parked", "queued", "running", "succeeded"];
  const outputs: Record<string, string> = {};
  try {
    const result = await runWorkflow(
      { ...config, agentRuntime: "standing-runtime" },
      root,
      dependencies(client, outputs),
    );
    assert.equal(result.phase, "succeeded");
    assert.equal(
      client.requests[0] && "agentRuntimeUid" in client.requests[0]
        ? client.requests[0].agentRuntimeUid
        : undefined,
      "standing-runtime",
    );
    assert.ok(client.calls.includes("download"));
    assert.equal(client.calls.at(-1), "finalize");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Task failure and corrupt outputs still finalize and fail the action", async () => {
  for (const mode of ["failed", "corrupt"] as const) {
    const root = await fixture();
    const client = new FakeClient();
    if (mode === "failed") client.phases = ["failed"];
    else client.archivePath = "undeclared/report.txt";
    const outputs: Record<string, string> = {};
    try {
      await assert.rejects(
        runWorkflow(config, root, dependencies(client, outputs)),
        (error: unknown) => {
          assert.ok(error instanceof StewardRunFailure);
          assert.equal(error.metadata.phase, mode === "failed" ? "failed" : "succeeded");
          assert.equal(error.metadata.failureCategory, mode === "failed" ? "unknown" : "input-output");
          assert.equal(error.metadata.cleanupCategory, "confirmed");
          return true;
        },
      );
      assert.equal(client.calls.at(-1), "finalize");
      assert.equal(outputs["runtime-uid"], "runtime-uid-1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("every post-submission lifecycle failure still finalizes the Task", async (context) => {
  for (const failurePoint of [
    "task-output",
    "runtime-output",
    "upload",
    "execute",
    "poll",
    "status-output",
    "download",
  ] as const) {
    await context.test(failurePoint, async () => {
      const root = await fixture();
      const client = new FakeClient();
      const lifecycleDependencies = dependencies(client, {});
      if (failurePoint === "task-output" || failurePoint === "runtime-output" || failurePoint === "status-output") {
        const outputName = failurePoint === "task-output"
          ? "task-uid"
          : failurePoint === "runtime-output"
            ? "runtime-uid"
            : "status";
        lifecycleDependencies.setOutput = async (name: string) => {
          if (name === outputName) throw new Error(`failed ${failurePoint}`);
        };
      } else if (failurePoint === "upload") {
        client.uploadTaskInputs = async () => {
          client.calls.push("upload");
          throw new Error("failed upload");
        };
      } else if (failurePoint === "execute") {
        client.executeTask = async () => {
          client.calls.push("execute");
          throw new Error("failed execute");
        };
      } else if (failurePoint === "poll") {
        client.getTask = async () => {
          client.calls.push("poll");
          throw new Error("failed poll");
        };
      } else {
        client.downloadTaskOutputs = async () => {
          client.calls.push("download");
          throw new Error("failed download");
        };
      }
      try {
        await assert.rejects(runWorkflow(config, root, lifecycleDependencies), StewardRunFailure);
        assert.equal(client.calls.at(-1), "finalize");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("terminal Task and cleanup failures expose only independent allowlisted metadata", async () => {
  const root = await fixture();
  try {
    const failed = new FakeClient();
    failed.phases = ["failed"];
    failed.failureReason = "task agent exited with code 71";
    await assert.rejects(runWorkflow(config, root, dependencies(failed, {})), (error: unknown) => {
      assert.ok(error instanceof StewardRunFailure);
      assert.deepEqual(error.metadata, {
        version: "steward-run.failure/v1",
        phase: "failed",
        failureCategory: "provider-token-grant",
        cleanupCategory: "confirmed",
      });
      assert.doesNotMatch(error.message, /task agent exited/u);
      return true;
    });

    const missingProviderGrant = new FakeClient();
    missingProviderGrant.phases = ["failed"];
    missingProviderGrant.failureReason = "task agent exited with code 76";
    await assert.rejects(
      runWorkflow(config, root, dependencies(missingProviderGrant, {})),
      (error: unknown) => {
        assert.ok(error instanceof StewardRunFailure);
        assert.deepEqual(error.metadata, {
          version: "steward-run.failure/v1",
          phase: "failed",
          failureCategory: "provider-grant",
          cleanupCategory: "confirmed",
        });
        assert.doesNotMatch(error.message, /task agent exited|provider response/u);
        return true;
      },
    );

    const providerProtocolFailure = new FakeClient();
    providerProtocolFailure.phases = ["failed"];
    providerProtocolFailure.failureReason = "task agent exited with code 77";
    await assert.rejects(
      runWorkflow(config, root, dependencies(providerProtocolFailure, {})),
      (error: unknown) => {
        assert.ok(error instanceof StewardRunFailure);
        assert.deepEqual(error.metadata, {
          version: "steward-run.failure/v1",
          phase: "failed",
          failureCategory: "provider-protocol",
          cleanupCategory: "confirmed",
        });
        assert.doesNotMatch(error.message, /task agent exited|provider response/u);
        return true;
      },
    );

    for (const [exitCode, assertionStage] of [
      [78, "input-request"],
      [79, "runtime-toolchain"],
      [80, "model-result"],
      [81, "mcp-tool-event"],
    ] as const) {
      const stagedAssertionFailure = new FakeClient();
      stagedAssertionFailure.phases = ["failed"];
      stagedAssertionFailure.failureReason = `task agent exited with code ${exitCode}`;
      await assert.rejects(
        runWorkflow(config, root, dependencies(stagedAssertionFailure, {})),
        (error: unknown) => {
          assert.ok(error instanceof StewardRunFailure);
          assert.deepEqual(error.metadata, {
            version: "steward-run.failure/v1",
            phase: "failed",
            failureCategory: "assertion-mismatch",
            cleanupCategory: "confirmed",
            assertionStage,
          });
          assert.doesNotMatch(error.message, /task agent exited|assertion-stage/u);
          return true;
        },
      );
    }

    const upstreamTransportFailure = new FakeClient();
    upstreamTransportFailure.phases = ["failed"];
    upstreamTransportFailure.failureReason = "task agent exited with code 87";
    await assert.rejects(
      runWorkflow(config, root, dependencies(upstreamTransportFailure, {})),
      (error: unknown) => {
        assert.ok(error instanceof StewardRunFailure);
        assert.deepEqual(error.metadata, {
          version: "steward-run.failure/v1",
          phase: "failed",
          failureCategory: "provider-connection",
          cleanupCategory: "confirmed",
          providerConnectionStage: "model-gateway",
          providerConnectionStageV2: "litellm-http",
          providerConnectionStageV3: "litellm-transport",
        });
        assert.doesNotMatch(error.message, /task agent exited|transport|http/u);
        return true;
      },
    );

    const failedWithOutputError = new FakeClient();
    failedWithOutputError.phases = ["failed"];
    failedWithOutputError.failureReason = "task agent exited with code 72";
    const outputErrorDependencies = dependencies(failedWithOutputError, {});
    outputErrorDependencies.setOutput = async (name: string) => {
      if (name === "status") throw new Error("output contained private response data");
    };
    await assert.rejects(
      runWorkflow(config, root, outputErrorDependencies),
      (error: unknown) => {
        assert.ok(error instanceof StewardRunFailure);
        assert.equal(error.metadata.failureCategory, "provider-authorization");
        assert.equal(error.metadata.cleanupCategory, "confirmed");
        assert.doesNotMatch(error.message, /private response data/u);
        return true;
      },
    );

    const failedWithCleanup = new FakeClient();
    failedWithCleanup.phases = ["failed"];
    failedWithCleanup.failureReason = "task agent exited with code 70";
    failedWithCleanup.finalizeError = new Error("response body contained secret-value");
    await assert.rejects(
      runWorkflow(config, root, dependencies(failedWithCleanup, {})),
      (error: unknown) => {
        assert.ok(error instanceof StewardRunFailure);
        assert.deepEqual(error.metadata, {
          version: "steward-run.failure/v1",
          phase: "failed",
          failureCategory: "provider-connection",
          cleanupCategory: "request-failed",
        });
        assert.doesNotMatch(error.message, /secret-value|response body/u);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing inputs fail before any Steward request and Task cleanup failure is fatal", async () => {
  const root = await fixture();
  try {
    const missingClient = new FakeClient();
    await assert.rejects(
      runWorkflow({ ...config, inputPaths: "missing" }, root, dependencies(missingClient, {})),
      (error: unknown) => {
        assert.ok(error instanceof StewardRunFailure);
        assert.deepEqual(error.metadata, {
          version: "steward-run.failure/v1",
          phase: "unavailable",
          failureCategory: "input-output",
          cleanupCategory: "not-required",
        });
        return true;
      },
    );
    assert.deepEqual(missingClient.calls, []);

    const cleanupClient = new FakeClient();
    cleanupClient.finalizeError = new Error("cleanup unavailable");
    await assert.rejects(
      runWorkflow(config, root, dependencies(cleanupClient, {})),
      (error: unknown) => {
        assert.ok(error instanceof StewardRunFailure);
        assert.deepEqual(error.metadata, {
          version: "steward-run.failure/v1",
          phase: "succeeded",
          failureCategory: "unknown",
          cleanupCategory: "request-failed",
        });
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("submit request diagnostics survive lifecycle sanitization", async (context) => {
  const root = await fixture();
  try {
    for (const [category, status] of [
      ["validation", 422],
      ["authentication", 401],
      ["authorization", 403],
      ["conflict", 409],
      ["dependency", 503],
      ["malformed-response", 201],
    ] as const) {
      await context.test(category, async () => {
        const client = new FakeClient();
        client.submitTask = async () => {
          throw new StewardRequestFailure("submit", category, {
            httpStatus: status,
            correlationId: "request-safe-123",
          });
        };
        await assert.rejects(
          runWorkflow(config, root, dependencies(client, {})),
          (error: unknown) => {
            assert.ok(error instanceof StewardRunFailure);
            assert.deepEqual(error.metadata, {
              version: "steward-run.failure/v1",
              phase: "unavailable",
              failureCategory: category,
              cleanupCategory: "not-required",
              requestStage: "submit",
              httpStatus: status,
              correlationId: "request-safe-123",
            });
            return true;
          },
        );
      });
    }

    for (const category of ["timeout", "transport"] as const) {
      await context.test(category, async () => {
        const client = new FakeClient();
        client.submitTask = async () => {
          throw new StewardRequestFailure("submit", category);
        };
        await assert.rejects(
          runWorkflow(config, root, dependencies(client, {})),
          (error: unknown) => {
            assert.ok(error instanceof StewardRunFailure);
            assert.equal(error.metadata.failureCategory, category);
            assert.equal(error.metadata.requestStage, "submit");
            assert.equal(error.metadata.httpStatus, undefined);
            assert.equal(error.metadata.correlationId, undefined);
            return true;
          },
        );
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalization tolerates real sandbox teardown latency and cancellation reports cancelled", async () => {
  const root = await fixture();
  try {
    const finalizing = new FakeClient();
    let finalizationStarted = false;
    let cleanupPolls = 0;
    finalizing.finalizeTask = async () => {
      finalizing.calls.push("finalize");
      finalizationStarted = true;
      return { ...baseTask, phase: "succeeded", finalized: false };
    };
    const originalGet = finalizing.getTask.bind(finalizing);
    finalizing.getTask = async () => {
      if (finalizationStarted) {
        finalizing.calls.push("cleanup-poll");
        cleanupPolls += 1;
        return { ...baseTask, phase: "succeeded", finalized: cleanupPolls >= 8 };
      }
      return originalGet();
    };
    await runWorkflow(config, root, dependencies(finalizing, {}));
    assert.equal(finalizing.calls.at(-1), "cleanup-poll");
    assert.equal(cleanupPolls, 8);

    const cancelling = new FakeClient();
    cancelling.phases = ["running"];
    const outputs: Record<string, string> = {};
    const controller = new AbortController();
    const deps = dependencies(cancelling, outputs);
    deps.sleep = async () => void controller.abort();
    await assert.rejects(
      runWorkflow(config, root, { ...deps, signal: controller.signal }),
      /cancelled/,
    );
    assert.equal(outputs.status, "cancelled");
    assert.equal(cancelling.calls.at(-1), "finalize");

    const cancellingWithOutputError = new FakeClient();
    cancellingWithOutputError.phases = ["running"];
    const outputController = new AbortController();
    const outputDeps = dependencies(cancellingWithOutputError, {});
    outputDeps.sleep = async () => void outputController.abort();
    outputDeps.setOutput = async (name: string) => {
      if (name === "status") throw new Error("private cancellation output error");
    };
    await assert.rejects(
      runWorkflow(config, root, { ...outputDeps, signal: outputController.signal }),
      (error: unknown) => {
        assert.ok(error instanceof StewardRunFailure);
        assert.equal(error.metadata.phase, "cancelled");
        assert.equal(error.metadata.failureCategory, "cancelled");
        assert.equal(error.metadata.cleanupCategory, "confirmed");
        assert.doesNotMatch(error.message, /private cancellation output/u);
        return true;
      },
    );
    assert.equal(cancellingWithOutputError.calls.at(-1), "finalize");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalization identity and timeout failures use distinct bounded cleanup categories", async () => {
  const root = await fixture();
  try {
    for (const mode of ["identity", "timeout"] as const) {
      const client = new FakeClient();
      let finalizationStarted = false;
      client.finalizeTask = async () => {
        client.calls.push("finalize");
        finalizationStarted = true;
        return { ...baseTask, phase: "succeeded", finalized: false };
      };
      const originalGet = client.getTask.bind(client);
      client.getTask = async () => {
        if (!finalizationStarted) return originalGet();
        client.calls.push("cleanup-poll");
        return mode === "identity"
          ? { ...baseTask, taskUid: "changed-task", phase: "succeeded", finalized: false }
          : { ...baseTask, phase: "succeeded", finalized: false };
      };

      await assert.rejects(runWorkflow(config, root, dependencies(client, {})), (error: unknown) => {
        assert.ok(error instanceof StewardRunFailure);
        assert.equal(error.metadata.phase, "succeeded");
        assert.equal(error.metadata.failureCategory, "unknown");
        assert.equal(
          error.metadata.cleanupCategory,
          mode === "identity" ? "identity-mismatch" : "confirmation-timeout",
        );
        return true;
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("idempotency keys are stable for one job identity", () => {
  const identity = {
    GITHUB_REPOSITORY: "apelogic-ai/example",
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_JOB: "agent",
  };
  assert.equal(createIdempotencyKey(identity), createIdempotencyKey(identity));
  for (const [field, value] of [
    ["GITHUB_REPOSITORY", "apelogic-ai/other"],
    ["GITHUB_RUN_ID", "456"],
    ["GITHUB_RUN_ATTEMPT", "2"],
    ["GITHUB_JOB", "other"],
  ] as const) {
    assert.notEqual(
      createIdempotencyKey(identity),
      createIdempotencyKey({ ...identity, [field]: value }),
      field,
    );
  }
  assert.match(createIdempotencyKey(identity), /^[a-f0-9]{64}$/);
});
