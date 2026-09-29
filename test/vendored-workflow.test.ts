import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { parse } from "yaml";

const execFileAsync = promisify(execFile);

test("the official private-fork workflow renders one immutable direct action", async () => {
  const work = await mkdtemp(join(tmpdir(), "steward-run-vendored-workflow-"));
  try {
    const manifest = join(work, "oss-release-manifest.json");
    const output = join(work, ".github/workflows/steward-task-vendored.yml");
    await writeFile(
      manifest,
      JSON.stringify({
        schemaVersion: 3,
        workflowRepository: "customer-org/steward-run",
        actionCommit: "a".repeat(40),
      }),
    );
    await execFileAsync(
      process.execPath,
      ["scripts/render-vendored-workflow.mjs", manifest, output],
      { cwd: new URL("..", import.meta.url) },
    );
    const rendered = await readFile(output, "utf8");
    const workflow = parse(rendered) as {
      on: { workflow_call: { inputs: Record<string, unknown> } };
      jobs: { governed: { permissions: Record<string, string>; steps: Array<Record<string, unknown>> } };
    };
    const steps = workflow.jobs.governed.steps;
    const task = steps.find((step) => step.id === "task");
    assert.equal(task?.uses, `customer-org/steward-run@${"a".repeat(40)}`);
    assert.equal(steps.some((step) => step.id === "workflow-source"), false);
    assert.equal(
      steps.some((step) => step.name === "Reserve the trusted action checkout path"),
      false,
    );
    assert.deepEqual(workflow.jobs.governed.permissions, {
      contents: "read",
      "id-token": "write",
    });
    for (const forbidden of ["token", "pat", "checkout-token", "action-ref"]) {
      assert.equal(workflow.on.workflow_call.inputs[forbidden], undefined, forbidden);
    }
    assert.doesNotMatch(rendered, /STEWARD_RUN_(?:OWNER|REPOSITORY|ACTION_COMMIT)/u);
    assert.match(rendered, /actions\/checkout@[a-f0-9]{40} # v4\.4\.0/u);
    assert.match(rendered, /actions\/upload-artifact@[a-f0-9]{40} # v4\.6\.2/u);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("the vendored workflow reports an empty governed output explicitly", async () => {
  const source = await readFile(
    new URL("../vendor/steward-task-vendored.yml", import.meta.url),
    "utf8",
  );
  const workflow = parse(source) as {
    jobs: { governed: { steps: Array<{ name?: string; run?: string }> } };
  };
  const step = workflow.jobs.governed.steps.find(
    (candidate) => candidate.name === "Require governed outputs",
  );
  assert.ok(step?.run);
  assert.match(step.run, /the task wrote nothing to out\//u);

  const work = await mkdtemp(join(tmpdir(), "steward-run-vendored-outputs-"));
  try {
    await assert.rejects(
      execFileAsync("bash", ["-c", step.run], { cwd: work }),
      /the task wrote nothing to out\//u,
    );
    await mkdir(join(work, "out"));
    await writeFile(join(work, "out", "result.txt"), "result\n");
    await assert.doesNotReject(execFileAsync("bash", ["-c", step.run], { cwd: work }));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("the renderer rejects unverified or mutable action coordinates", async () => {
  const work = await mkdtemp(join(tmpdir(), "steward-run-vendored-invalid-"));
  try {
    const manifest = join(work, "manifest.json");
    const output = join(work, "workflow.yml");
    for (const candidate of [
      { schemaVersion: 4, workflowRepository: "customer-org/steward-run", actionCommit: "a".repeat(40) },
      { schemaVersion: 3, workflowRepository: "invalid", actionCommit: "a".repeat(40) },
      { schemaVersion: 3, workflowRepository: "customer-org/steward-run", actionCommit: "main" },
    ]) {
      await writeFile(manifest, JSON.stringify(candidate));
      await assert.rejects(
        execFileAsync(process.execPath, ["scripts/render-vendored-workflow.mjs", manifest, output], {
          cwd: new URL("..", import.meta.url),
        }),
      );
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
