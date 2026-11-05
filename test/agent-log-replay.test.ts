import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import tar from "tar-stream";
import type { WorkflowConfig } from "../src/config.ts";
import { StewardRunFailure } from "../src/failure-metadata.ts";
import { runWorkflow, type TaskClient } from "../src/lifecycle.ts";
import {
  StewardRequestFailure,
  type Task,
  type TaskSubmissionRequest,
} from "../src/steward-client.ts";

const taskUid = "2f9f6ade-261d-4090-9532-9e157b59db2e";

const sources: Array<{ name: string; config: WorkflowConfig }> = [
  {
    name: "workflow",
    config: {
      workflow: "repository-review@1",
      inputPaths: "in",
      outputPaths: "results",
      apiUrl: "https://steward.example.test",
    },
  },
  {
    name: "invocation-path",
    config: {
      invocationPath: ".steward/tasks/release-summary.json",
      inputPaths: "in",
      outputPaths: "results",
      apiUrl: "https://steward.example.test",
    },
  },
  {
    name: "package-path",
    config: {
      packagePath: ".steward/packages/release-summary/task-definition.json",
      executionLog: "off",
      inputPaths: "in",
      outputPaths: "results",
      apiUrl: "https://steward.example.test",
    },
  },
];

function task(
  phase: Task["phase"],
  direct: boolean,
  finalized = false,
): Task {
  return {
    ...(direct
      ? { contractVersion: "steward.task/v2" as const, diagnostics: { executionLog: "off" as const } }
      : {}),
    taskUid,
    runtimeUid: "runtime-uid-1",
    runtimeOwnership: "provisioned",
    phase,
    finalized,
    ...(phase === "failed" ? { failureReason: "task agent exited with code 70" } : {}),
    deltas: [],
  };
}

async function outputArchive(): Promise<Readable> {
  const pack = tar.pack();
  pack.entry({ name: "results/report.txt" }, "done\n");
  pack.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of pack) chunks.push(Buffer.from(chunk));
  return Readable.from(Buffer.concat(chunks));
}

class LogClient implements TaskClient {
  readonly calls: string[] = [];
  readonly direct: boolean;
  readonly terminalPhase: "succeeded" | "failed";
  logsAvailable = true;
  logError?: Error;

  constructor(direct: boolean, terminalPhase: "succeeded" | "failed") {
    this.direct = direct;
    this.terminalPhase = terminalPhase;
  }

  async submitTask(_request: TaskSubmissionRequest): Promise<Task> {
    this.calls.push("submit");
    return task("submitted", this.direct);
  }

  async uploadTaskInputs(_uid: string, createArchive: () => Promise<Readable>): Promise<void> {
    this.calls.push("upload");
    for await (const _chunk of await createArchive()) {
      // Exercise the real input archive flow.
    }
  }

  async executeTask(): Promise<Task> {
    this.calls.push("execute");
    return task("running", this.direct);
  }

  async getTask(): Promise<Task> {
    this.calls.push("poll");
    return task(this.terminalPhase, this.direct);
  }

  async downloadTaskLog(_uid: string, stream: "stdout" | "stderr"): Promise<Buffer | undefined> {
    this.calls.push(`log:${stream}`);
    if (this.logError) throw this.logError;
    if (!this.logsAvailable) return undefined;
    return Buffer.from(
      stream === "stdout" ? "agent stdout\n::error::must stay inert\n" : "agent stderr\n",
    );
  }

  async downloadTaskOutputs(): Promise<Readable> {
    this.calls.push("download");
    return outputArchive();
  }

  async finalizeTask(): Promise<Task> {
    this.calls.push("finalize");
    return task(this.terminalPhase, this.direct, true);
  }
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "steward-run-agent-logs-"));
  await mkdir(join(root, "in"));
  await writeFile(join(root, "in", "request.txt"), "request\n");
  await mkdir(join(root, ".steward", "tasks"), { recursive: true });
  await writeFile(join(root, ".steward", "tasks", "release-summary.json"), "{}\n");
  await mkdir(join(root, ".steward", "packages", "release-summary"), { recursive: true });
  await writeFile(
    join(root, ".steward", "packages", "release-summary", "task-definition.json"),
    "{}\n",
  );
  return root;
}

function dependencies(
  client: TaskClient,
  writes: Array<{ channel: "stdout" | "stderr"; value: Buffer }>,
) {
  return {
    client,
    environment: {
      GITHUB_REPOSITORY: "example-org/example",
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

for (const source of sources) {
  for (const terminalPhase of ["succeeded", "failed"] as const) {
    test(`${source.name} replays both agent streams after a ${terminalPhase} Task`, async () => {
      const root = await workspace();
      const client = new LogClient(source.name !== "workflow", terminalPhase);
      const writes: Array<{ channel: "stdout" | "stderr"; value: Buffer }> = [];
      try {
        const run = runWorkflow(source.config, root, dependencies(client, writes));
        if (terminalPhase === "failed") await assert.rejects(run, StewardRunFailure);
        else assert.equal((await run).phase, "succeeded");

        const stdout = Buffer.concat(
          writes.filter((entry) => entry.channel === "stdout").map((entry) => entry.value),
        ).toString("utf8");
        const stderr = Buffer.concat(
          writes.filter((entry) => entry.channel === "stderr").map((entry) => entry.value),
        ).toString("utf8");
        assert.deepEqual(
          client.calls.filter((call) => call.startsWith("log:")),
          ["log:stdout", "log:stderr"],
        );
        assert.match(stdout, /::group::Steward Task stdout/u);
        assert.ok(
          stdout.indexOf("::stop-commands::steward-safe-token") <
            stdout.indexOf("::error::must stay inert"),
        );
        assert.ok(
          stdout.indexOf("::error::must stay inert") < stdout.indexOf("::steward-safe-token::"),
        );
        assert.match(stderr, /::group::Steward Task stderr/u);
        assert.match(stderr, /agent stderr/u);
        assert.equal(client.calls.at(-1), "finalize");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}

test("an older server without the Task logs route emits one notice and continues", async () => {
  const root = await workspace();
  const client = new LogClient(false, "succeeded");
  client.logsAvailable = false;
  const writes: Array<{ channel: "stdout" | "stderr"; value: Buffer }> = [];
  try {
    assert.equal(
      (await runWorkflow(sources[0]!.config, root, dependencies(client, writes))).phase,
      "succeeded",
    );
    const visible = Buffer.concat(writes.map((entry) => entry.value)).toString("utf8");
    assert.equal(visible.match(/Agent logs are unavailable from this server/g)?.length, 1);
    assert.deepEqual(
      client.calls.filter((call) => call.startsWith("log:")),
      ["log:stdout"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const [name, error] of [
  ["a 500 response", new StewardRequestFailure("output", "dependency", { httpStatus: 500 })],
  [
    "an unexpected content type",
    new StewardRequestFailure("output", "malformed-response", { httpStatus: 200 }),
  ],
] as const) {
  test(`${name} while reading logs does not fail a succeeded Task`, async () => {
    const root = await workspace();
    const client = new LogClient(false, "succeeded");
    client.logError = error;
    const writes: Array<{ channel: "stdout" | "stderr"; value: Buffer }> = [];
    try {
      assert.equal(
        (await runWorkflow(sources[0]!.config, root, dependencies(client, writes))).phase,
        "succeeded",
      );
      const visible = Buffer.concat(writes.map((entry) => entry.value)).toString("utf8");
      assert.equal(visible.match(/Agent logs could not be retrieved; continuing without them\./g)?.length, 1);
      assert.equal(client.calls.includes("download"), true);
      assert.equal(client.calls.at(-1), "finalize");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
