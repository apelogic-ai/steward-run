import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import tar from "tar-stream";
import type { ActionConfig } from "../src/config.ts";
import {
  createIdempotencyKey,
  runWorkflow,
  type RunClient,
} from "../src/lifecycle.ts";
import type { CreateRunRequest, Run } from "../src/steward-client.ts";

const baseRun: Run = {
  runUid: "2f9f6ade-261d-4090-9532-9e157b59db2e",
  runtimeUid: "runtime-uid-1",
  phase: "accepted",
  runtimeOwnership: "provisioned",
  finalized: false,
};

const config: ActionConfig = {
  workflow: "cve-triage",
  inputPaths: "in",
  outputPaths: "results",
  apiUrl: "https://steward.example.test",
  oidcAudience: "steward",
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

class FakeClient implements RunClient {
  readonly calls: string[] = [];
  readonly requests: CreateRunRequest[] = [];
  phases: Run["phase"][] = ["running", "succeeded"];
  ownership: Run["runtimeOwnership"] = "provisioned";
  archivePath = "results/report.txt";
  finalizeError?: Error;

  async createRun(request: CreateRunRequest): Promise<Run> {
    this.calls.push("create");
    this.requests.push(request);
    return { ...baseRun, runtimeOwnership: this.ownership };
  }
  async uploadInputs(_uid: string, createArchive: () => Promise<Readable>): Promise<void> {
    this.calls.push("upload");
    for await (const _chunk of await createArchive()) {
      // Exercise the real input stream.
    }
  }
  async executeRun(): Promise<Run> {
    this.calls.push("execute");
    return { ...baseRun, phase: "running", runtimeOwnership: this.ownership };
  }
  async getRun(): Promise<Run> {
    this.calls.push("poll");
    return {
      ...baseRun,
      phase: this.phases.shift() ?? "succeeded",
      runtimeOwnership: this.ownership,
    };
  }
  async downloadOutputs(): Promise<Readable> {
    this.calls.push("download");
    return outputArchive(this.archivePath);
  }
  async finalizeRun(): Promise<Run> {
    this.calls.push("finalize");
    if (this.finalizeError) throw this.finalizeError;
    return { ...baseRun, phase: "cancelled", runtimeOwnership: this.ownership, finalized: true };
  }
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "steward-run-lifecycle-"));
  await mkdir(join(root, "in"));
  await writeFile(join(root, "in", "request.txt"), "work");
  return root;
}

function dependencies(client: RunClient, outputs: Record<string, string>) {
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

test("a provisioned run round-trips files, reports outputs, and finalizes", async () => {
  const root = await fixture();
  const client = new FakeClient();
  const outputs: Record<string, string> = {};
  try {
    const result = await runWorkflow(config, root, dependencies(client, outputs));
    assert.equal(result.phase, "succeeded");
    assert.equal(await readFile(join(root, "results", "report.txt"), "utf8"), "done");
    assert.deepEqual(outputs, { status: "succeeded", "runtime-uid": "runtime-uid-1" });
    assert.deepEqual(client.calls, ["create", "upload", "execute", "poll", "poll", "download", "finalize"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adoption is explicit and a parked run returns without downloading outputs", async () => {
  const root = await fixture();
  const client = new FakeClient();
  client.ownership = "adopted";
  client.phases = ["parked"];
  const outputs: Record<string, string> = {};
  try {
    const result = await runWorkflow(
      { ...config, agentRuntime: "standing-runtime" },
      root,
      dependencies(client, outputs),
    );
    assert.equal(result.phase, "parked");
    assert.equal(client.requests[0]?.agentRuntimeUid, "standing-runtime");
    assert.ok(!client.calls.includes("download"));
    assert.equal(client.calls.at(-1), "finalize");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent failure and corrupt outputs still finalize and fail the action", async () => {
  for (const mode of ["failed", "corrupt"] as const) {
    const root = await fixture();
    const client = new FakeClient();
    if (mode === "failed") client.phases = ["failed"];
    else client.archivePath = "undeclared/report.txt";
    const outputs: Record<string, string> = {};
    try {
      await assert.rejects(
        runWorkflow(config, root, dependencies(client, outputs)),
        mode === "failed" ? /Steward run failed/ : /not a declared output/,
      );
      assert.equal(client.calls.at(-1), "finalize");
      assert.equal(outputs["runtime-uid"], "runtime-uid-1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("missing inputs fail before any Steward request and cleanup failure is fatal", async () => {
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

test("finalization is polled to confirmation and cancellation reports cancelled", async () => {
  const root = await fixture();
  try {
    const finalizing = new FakeClient();
    let finalizationStarted = false;
    finalizing.finalizeRun = async () => {
      finalizing.calls.push("finalize");
      finalizationStarted = true;
      return { ...baseRun, phase: "succeeded", finalized: false };
    };
    const originalGet = finalizing.getRun.bind(finalizing);
    finalizing.getRun = async () => {
      if (finalizationStarted) {
        finalizing.calls.push("cleanup-poll");
        return { ...baseRun, phase: "succeeded", finalized: true };
      }
      return originalGet();
    };
    await runWorkflow(config, root, dependencies(finalizing, {}));
    assert.equal(finalizing.calls.at(-1), "cleanup-poll");

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
