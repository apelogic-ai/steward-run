import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    const output = join(work, ".github/workflows/steward-task-self-hosted.yml");
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
