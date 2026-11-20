import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { startMockSteward, type MockSteward } from "./support/mock-steward.ts";

// GitHub stops a step with SIGINT, then SIGTERM 7.5 s later, then SIGKILL 2.5 s after that.
const runnerGraceMilliseconds = 7_500;

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.test-signature`;
}

async function until(condition: () => boolean, timeoutMilliseconds = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition was not met in time");
    await delay(20);
  }
}

const submittedTaskUid = "2f9f6ade-261d-4090-9532-9e157b59db2e";

interface Fixture {
  workspace: string;
  outputFile: string;
  stateFile: string;
  mock: MockSteward;
  start: (args?: readonly string[]) => {
    exited: Promise<number | null>;
    kill: (signal: NodeJS.Signals) => void;
    stdout: () => string;
    stderr: () => string;
  };
}

async function withFixture(
  options: { runUntilCancelled?: boolean; refuseCleanupStatus?: number },
  body: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), "steward-run-cancel-"));
  const outputFile = join(workspace, "github-output");
  const stateFile = join(workspace, "runner-temp", "steward-run.test", "task-uid");
  const bearerFile = join(workspace, "projected-token.jwt");
  const issuedAt = Math.floor(Date.now() / 1_000);
  const bearer = jwt({ aud: "steward-task-api", exp: issuedAt + 300, iat: issuedAt });
  const mock = await startMockSteward({ acceptedBearerToken: bearer, ...options });
  try {
    await mkdir(join(workspace, "in"));
    await mkdir(join(workspace, "runner-temp", "steward-run.test"), { recursive: true });
    await writeFile(join(workspace, "in", "payload.bin"), "cancel fixture");
    await writeFile(bearerFile, bearer);
    await writeFile(outputFile, "");
    const start = (args: readonly string[] = []) => {
      const child = spawn(process.execPath, ["dist/index.cjs", ...args], {
        cwd: new URL("..", import.meta.url),
        env: {
          ...process.env,
          GITHUB_JOB: "agent",
          GITHUB_OUTPUT: outputFile,
          GITHUB_REPOSITORY: "apelogic-ai/example",
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_RUN_ID: "123",
          GITHUB_WORKSPACE: workspace,
          STEWARD_RUN_API_URL: mock.url,
          STEWARD_RUN_BEARER_TOKEN_FILE: bearerFile,
          STEWARD_RUN_CANCEL_STATE_FILE: stateFile,
          STEWARD_RUN_INPUTS: "in",
          STEWARD_RUN_OUTPUTS: "out/payload.bin",
          STEWARD_RUN_WORKFLOW: "repository-review@1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += String(chunk)));
      child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += String(chunk)));
      return {
        exited: new Promise<number | null>((resolve) => child.once("exit", resolve)),
        kill: (signal: NodeJS.Signals) => void child.kill(signal),
        stdout: () => stdout,
        stderr: () => stderr,
      };
    };
    await body({ workspace, outputFile, stateFile, mock, start });
  } finally {
    await mock.close();
    await rm(workspace, { recursive: true, force: true });
  }
}

async function stoppedRun(
  signals: readonly NodeJS.Signals[],
  ready: (mock: MockSteward) => boolean,
) {
  let result: {
    code: number | null;
    elapsed: number;
    operations: string[];
    outputs: string;
    stdout: string;
  } | undefined;
  await withFixture({ runUntilCancelled: true }, async ({ mock, outputFile, start }) => {
    const run = start();
    await until(() => ready(mock));
    const stoppedAt = Date.now();
    for (const signal of signals) run.kill(signal);
    const code = await run.exited;
    result = {
      code,
      elapsed: Date.now() - stoppedAt,
      operations: [...mock.observations.operations],
      outputs: await readFile(outputFile, "utf8"),
      stdout: run.stdout(),
    };
  });
  if (!result) throw new Error("stopped run did not complete");
  return result;
}

const deleteSubmittedTask = `DELETE /v1/tasks/${submittedTaskUid}`;

for (const signals of [["SIGTERM"], ["SIGINT"], ["SIGINT", "SIGTERM"]] as const) {
  test(`${signals.join(" then ")} during execution cancels the submitted Task and exits cancelled`, async () => {
    const run = await stoppedRun(signals, (mock) => mock.observations.operations.includes("poll"));

    assert.equal(run.operations.filter((operation) => operation === "finalize").length, 1);
    assert.ok(run.operations.indexOf("execute") < run.operations.indexOf("finalize"));
    assert.ok(run.elapsed < runnerGraceMilliseconds, `stopped after ${run.elapsed} ms`);
    assert.notEqual(run.code, 0);
    assert.match(run.outputs, /^outcome=cancelled$/mu);
    assert.match(run.outputs, /^status=cancelled$/mu);
    assert.match(run.outputs, /^failure-category=cancelled$/mu);
    assert.match(run.outputs, new RegExp(`^task-uid=${submittedTaskUid}$`, "mu"));
    assert.doesNotMatch(run.outputs, /^outcome=failure$/mu);
    assert.match(run.stdout, new RegExp(`^Cancelled Steward run ${submittedTaskUid}$`, "mu"));
  });
}

test("a refused cancel on SIGTERM is reported and keeps the cancelled outcome", async () => {
  await withFixture(
    { runUntilCancelled: true, refuseCleanupStatus: 409 },
    async ({ mock, outputFile, start }) => {
      const run = start();
      await until(() => mock.observations.operations.includes("poll"));
      run.kill("SIGTERM");
      assert.notEqual(await run.exited, 0);

      assert.deepEqual(
        mock.observations.requests.filter((r) => r.startsWith("DELETE ")),
        [deleteSubmittedTask],
      );
      assert.match(
        run.stdout(),
        new RegExp(`^Couldn't cancel Steward run ${submittedTaskUid}: conflict \\(HTTP 409\\)$`, "mu"),
      );
      const outputs = await readFile(outputFile, "utf8");
      assert.match(outputs, /^outcome=cancelled$/mu);
      assert.match(outputs, /^failure-category=cancelled$/mu);
    },
  );
});

test("a run killed without a signal leaves its Task for the cancel step, which cancels exactly that Task", async () => {
  // A container job runs the step through `docker exec`, which never forwards SIGINT or SIGTERM;
  // the process is killed outright when the job container is removed.
  await withFixture({ runUntilCancelled: true }, async ({ mock, stateFile, start }) => {
    const run = start();
    await until(() => mock.observations.operations.includes("poll"));
    run.kill("SIGKILL");
    await run.exited;
    assert.equal(mock.observations.requests.filter((r) => r.startsWith("DELETE ")).length, 0);
    assert.equal(await readFile(stateFile, "utf8"), `${submittedTaskUid}\n`);

    const cancel = start(["--cancel-recorded-task"]);
    const code = await cancel.exited;

    assert.equal(code, 0, cancel.stderr());
    assert.deepEqual(
      mock.observations.requests.filter((r) => r.startsWith("DELETE ")),
      [deleteSubmittedTask],
    );
    assert.equal(cancel.stdout(), `Cancelled Steward run ${submittedTaskUid}\n`);
    await assert.rejects(readFile(stateFile, "utf8"), { code: "ENOENT" });
  });
});

test("the cancel step reports a refused cancel without failing the step", async () => {
  await withFixture({ runUntilCancelled: true }, async ({ mock, stateFile, start }) => {
    await writeFile(stateFile, "0b0e3a35-7d7a-4c4e-9f43-7ff3c0b6d0a1\n");
    const cancel = start(["--cancel-recorded-task"]);
    const code = await cancel.exited;

    assert.equal(code, 0, cancel.stderr());
    assert.deepEqual(
      mock.observations.requests.filter((r) => r.startsWith("DELETE ")),
      ["DELETE /v1/tasks/0b0e3a35-7d7a-4c4e-9f43-7ff3c0b6d0a1"],
    );
    assert.match(
      cancel.stdout(),
      /^Couldn't cancel Steward run 0b0e3a35-7d7a-4c4e-9f43-7ff3c0b6d0a1: dependency \(HTTP 404\)$/mu,
    );
    assert.match(cancel.stdout(), /::error title=Steward Task cancel failed::/u);
  });
});

test("refusal: the cancel step sends nothing when this job recorded no submitted Task", async () => {
  await withFixture({}, async ({ mock, start }) => {
    const cancel = start(["--cancel-recorded-task"]);
    const code = await cancel.exited;

    assert.equal(code, 0, cancel.stderr());
    assert.deepEqual(mock.observations.requests, []);
    assert.equal(cancel.stdout(), "");
  });
});

test("refusal: the cancel step never sends a request for a recorded value that is not a Task UID", async () => {
  for (const recorded of [
    "../../v1/tasks\n",
    `${submittedTaskUid}/execute\n`,
    `${submittedTaskUid}\n${submittedTaskUid}\n`,
    "\n",
  ]) {
    await withFixture({}, async ({ mock, stateFile, start }) => {
      await writeFile(stateFile, recorded);
      const cancel = start(["--cancel-recorded-task"]);
      const code = await cancel.exited;

      assert.equal(code, 0, cancel.stderr());
      assert.deepEqual(mock.observations.requests, [], JSON.stringify(recorded));
      assert.match(cancel.stdout(), /^Couldn't cancel Steward run: the recorded value is not a Steward Task UID$/mu);
      assert.match(cancel.stdout(), /::error title=Steward Task cancel failed::/u);
    });
  }
});

test("refusal: a run that finished and finalized leaves nothing for the cancel step to cancel", async () => {
  await withFixture({}, async ({ mock, stateFile, start }) => {
    const run = start();
    assert.equal(await run.exited, 0, run.stderr());
    await assert.rejects(readFile(stateFile, "utf8"), { code: "ENOENT" });
    const requestsAfterRun = mock.observations.requests.length;

    const cancel = start(["--cancel-recorded-task"]);
    assert.equal(await cancel.exited, 0, cancel.stderr());

    assert.equal(mock.observations.requests.length, requestsAfterRun);
  });
});
