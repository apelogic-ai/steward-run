import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import tar from "tar-stream";
import type { WorkflowConfig } from "../src/config.ts";
import {
  createIdempotencyKey,
  runWorkflow,
  type TaskClient,
} from "../src/lifecycle.ts";
import type { Task, TaskSubmissionRequest } from "../src/steward-client.ts";

const baseTask: Task = {
  taskUid: "2f9f6ade-261d-4090-9532-9e157b59db2e",
  runtimeUid: "runtime-uid-1",
  phase: "submitted",
  runtimeOwnership: "provisioned",
  finalized: false,
  deltas: [],
};

const config: WorkflowConfig = {
  workflow: "cve-triage",
  inputPaths: "in",
  outputPaths: "results",
  apiUrl: "https://steward.example.test",
  codingAgentRuntime: "claude-code@2.1.220",
};

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
  finalizeError?: Error;

  async submitTask(request: TaskSubmissionRequest): Promise<Task> {
    this.calls.push("create");
    this.requests.push(request);
    return { ...baseTask, runtimeOwnership: this.ownership };
  }
  async uploadTaskInputs(_uid: string, createArchive: () => Promise<Readable>): Promise<void> {
    this.calls.push("upload");
    for await (const _chunk of await createArchive()) {
      // Exercise the real input stream.
    }
  }
  async executeTask(): Promise<Task> {
    this.calls.push("execute");
    return { ...baseTask, phase: "running", runtimeOwnership: this.ownership };
  }
  async getTask(): Promise<Task> {
    this.calls.push("poll");
    return {
      ...baseTask,
      phase: this.phases.shift() ?? "succeeded",
      runtimeOwnership: this.ownership,
    };
  }
  async downloadTaskOutputs(): Promise<Readable> {
    this.calls.push("download");
    return outputArchive(this.archivePath);
  }
  async finalizeTask(): Promise<Task> {
    this.calls.push("finalize");
    if (this.finalizeError) throw this.finalizeError;
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
    assert.deepEqual(client.calls, ["create", "upload", "execute", "poll", "poll", "download", "finalize"]);
  } finally {
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
    assert.equal(client.requests[0]?.agentRuntimeUid, "standing-runtime");
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
        mode === "failed" ? /Steward Task failed/ : /not a declared output/,
      );
      assert.equal(client.calls.at(-1), "finalize");
      assert.equal(outputs["runtime-uid"], "runtime-uid-1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("missing inputs fail before any Steward request and Task cleanup failure is fatal", async () => {
  const root = await fixture();
  try {
    const missingClient = new FakeClient();
    await assert.rejects(
      runWorkflow({ ...config, inputPaths: "missing" }, root, dependencies(missingClient, {})),
      /declared input does not exist/,
    );
    assert.deepEqual(missingClient.calls, []);

    const cleanupClient = new FakeClient();
    cleanupClient.finalizeError = new Error("cleanup unavailable");
    await assert.rejects(
      runWorkflow(config, root, dependencies(cleanupClient, {})),
      /cleanup unavailable/,
    );
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
  assert.notEqual(createIdempotencyKey(identity), createIdempotencyKey({ ...identity, GITHUB_JOB: "other" }));
  assert.match(createIdempotencyKey(identity), /^[a-f0-9]{64}$/);
});
