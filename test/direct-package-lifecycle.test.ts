import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import tar from "tar-stream";
import type { WorkflowConfig } from "../src/config.ts";
import { StewardRunFailure } from "../src/failure-metadata.ts";
import { runWorkflow, type TaskClient } from "../src/lifecycle.ts";
import type { Task, TaskSubmissionRequest } from "../src/steward-client.ts";

const taskUid = "2f9f6ade-261d-4090-9532-9e157b59db2e";

function directConfig(invocationPath = ".steward/tasks/release-summary.json"): WorkflowConfig {
  return {
    invocationPath,
    inputPaths: "in",
    outputPaths: "results",
    apiUrl: "https://steward.example.test",
  } as unknown as WorkflowConfig;
}

function task(
  phase: Task["phase"],
  executionLog: "off" | "full" = "full",
  finalized = false,
): Task {
  return {
    contractVersion: "steward.task/v2",
    taskUid,
    runtimeUid: "runtime-uid-1",
    runtimeOwnership: "provisioned",
    phase,
    finalized,
    deltas: [],
    diagnostics: { executionLog },
  } as unknown as Task;
}

async function archive(
  entries: Array<{ name: string; body?: string; type?: "file" | "directory" }>,
): Promise<Readable> {
  const pack = tar.pack();
  for (const entry of entries) {
    pack.entry({ name: entry.name, type: entry.type ?? "file" }, entry.body ?? "");
  }
  pack.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of pack) chunks.push(Buffer.from(chunk));
  return Readable.from(Buffer.concat(chunks));
}

class DirectClient implements TaskClient {
  readonly calls: string[] = [];
  request?: TaskSubmissionRequest;
  executionLog: "off" | "full" = "full";
  pollExecutionLog?: "off" | "full";
  outputEntries: Array<{ name: string; body?: string; type?: "file" | "directory" }> = [
    { name: "results/report.md", body: "# Result\n" },
    { name: ".steward", type: "directory" },
    { name: ".steward/diagnostics", type: "directory" },
    { name: ".steward/diagnostics/stdout.log", body: "agent stdout\n::error::not a command\n" },
    { name: ".steward/diagnostics/stderr.log", body: "agent stderr\n" },
  ];

  async submitTask(request: TaskSubmissionRequest): Promise<Task> {
    this.calls.push("submit");
    this.request = request;
    return task("submitted", this.executionLog);
  }
  async uploadTaskInputs(_taskUid: string, createArchive: () => Promise<Readable>): Promise<void> {
    this.calls.push("upload");
    for await (const _chunk of await createArchive()) {
      // Exercise the unchanged input archive flow.
    }
  }
  async executeTask(): Promise<Task> {
    this.calls.push("execute");
    return task("running", this.executionLog);
  }
  async getTask(): Promise<Task> {
    this.calls.push("poll");
    return task("succeeded", this.pollExecutionLog ?? this.executionLog);
  }
  async downloadTaskOutputs(): Promise<Readable> {
    this.calls.push("download");
    return archive(this.outputEntries);
  }
  async finalizeTask(): Promise<Task> {
    this.calls.push("finalize");
    return task("succeeded", this.executionLog, true);
  }
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "steward-run-direct-"));
  await mkdir(join(root, "in"));
  await writeFile(join(root, "in", "request.json"), "{}\n");
  await mkdir(join(root, ".steward", "tasks"), { recursive: true });
  await writeFile(join(root, ".steward", "tasks", "release-summary.json"), "private manifest bytes");
  return root;
}

function dependencies(
  client: TaskClient,
  writes: Array<{ channel: "stdout" | "stderr"; value: Buffer }> = [],
) {
  return {
    client,
    environment: {
      GITHUB_REPOSITORY: "apelogic-ai/example",
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_JOB: "agent",
    },
    setOutput: async () => undefined,
    sleep: async () => undefined,
    commandToken: () => "steward-safe-token",
    writeLog: async (channel: "stdout" | "stderr", value: string | Buffer) => {
      writes.push({ channel, value: Buffer.from(value) });
    },
  };
}

test("direct invocation transports only the path and replays successful transcripts safely", async () => {
  const root = await workspace();
  const client = new DirectClient();
  const writes: Array<{ channel: "stdout" | "stderr"; value: Buffer }> = [];
  try {
    await chmod(join(root, ".steward", "tasks", "release-summary.json"), 0o000);
    const result = await runWorkflow(directConfig(), root, dependencies(client, writes));

    assert.equal(result.phase, "succeeded");
    assert.deepEqual(client.request, {
      contractVersion: "steward.task/v2",
      invocationPath: ".steward/tasks/release-summary.json",
    });
    assert.equal(client.calls.at(-1), "finalize");
    await assert.rejects(lstat(join(root, ".steward", "diagnostics")), { code: "ENOENT" });

    const stdout = Buffer.concat(
      writes.filter((entry) => entry.channel === "stdout").map((entry) => entry.value),
    ).toString("utf8");
    const stderr = Buffer.concat(
      writes.filter((entry) => entry.channel === "stderr").map((entry) => entry.value),
    ).toString("utf8");
    assert.match(stdout, /::warning title=Sensitive Steward execution log::/u);
    assert.match(stdout, /::group::Steward Task stdout/u);
    assert.ok(stdout.indexOf("::stop-commands::steward-safe-token") < stdout.indexOf("::error::not a command"));
    assert.ok(stdout.indexOf("::error::not a command") < stdout.indexOf("::steward-safe-token::"));
    assert.match(stderr, /::group::Steward Task stderr/u);
    assert.match(stderr, /agent stderr/u);
  } finally {
    await chmod(join(root, ".steward", "tasks", "release-summary.json"), 0o600).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid, missing, directory, and symlinked invocation paths fail before submission", async () => {
  const root = await workspace();
  await symlink("release-summary.json", join(root, ".steward", "tasks", "linked.json"));
  try {
    for (const invocationPath of [
      "/absolute.json",
      "../escape.json",
      ".steward/./tasks/release-summary.json",
      ".steward//tasks/release-summary.json",
      ".steward\\tasks\\release-summary.json",
      " .steward/tasks/release-summary.json",
      ".steward/tasks/missing.json",
      ".steward/tasks",
      ".steward/tasks/linked.json",
      `.steward/tasks/${"a".repeat(493)}.json`,
      ".steward/tasks/not@canonical.json",
    ]) {
      const client = new DirectClient();
      await assert.rejects(runWorkflow(directConfig(invocationPath), root, dependencies(client)));
      assert.deepEqual(client.calls, [], invocationPath);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("transcript replay failure remains fatal but still finalizes", async () => {
  const root = await workspace();
  const client = new DirectClient();
  let writes = 0;
  const attempted: string[] = [];
  const lifecycleDependencies = dependencies(client);
  lifecycleDependencies.writeLog = async (_channel, value) => {
    writes += 1;
    attempted.push(Buffer.from(value).toString("utf8"));
    if (writes === 4) throw new Error("log sink failed");
  };
  try {
    await assert.rejects(runWorkflow(directConfig(), root, lifecycleDependencies), StewardRunFailure);
    assert.ok(writes >= 6);
    assert.ok(attempted.includes("::steward-safe-token::\n"));
    assert.ok(attempted.includes("::endgroup::\n"));
    assert.equal(client.calls.at(-1), "finalize");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("diagnostics off preserves outputs without replaying reserved streams", async () => {
  const root = await workspace();
  const client = new DirectClient();
  client.executionLog = "off";
  client.outputEntries = [{ name: "results/report.md", body: "# Result\n" }];
  const writes: Array<{ channel: "stdout" | "stderr"; value: Buffer }> = [];
  try {
    const result = await runWorkflow(directConfig(), root, dependencies(client, writes));
    assert.equal(result.phase, "succeeded");
    assert.deepEqual(writes, []);
    assert.equal(client.calls.at(-1), "finalize");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the authenticated diagnostic selection cannot change during the Task lifecycle", async () => {
  const root = await workspace();
  const client = new DirectClient();
  client.pollExecutionLog = "off";
  try {
    await assert.rejects(runWorkflow(directConfig(), root, dependencies(client)), StewardRunFailure);
    assert.equal(client.calls.includes("download"), false);
    assert.equal(client.calls.at(-1), "finalize");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
