import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repository = new URL("..", import.meta.url);
const jobContainerDigest = `sha256:${"c".repeat(64)}`;
const jobContainerImage = `registry.example/steward-run@${jobContainerDigest}`;

test("release manifest distinguishes workflow, action, runner, and job-container identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-release-"));
  const metadata = join(root, "build-metadata.json");
  const output = join(root, "release-manifest.json");
  const digest = `sha256:${"a".repeat(64)}`;
  const actionCommit = "b".repeat(40);
  const workflowCommit = "d".repeat(40);
  try {
    await writeFile(metadata, JSON.stringify({ "containerimage.digest": digest }), "utf8");
    await execFileAsync(
      process.execPath,
      [
        "scripts/write-release-manifest.mjs",
        metadata,
        output,
        "0.2.0",
        actionCommit,
        workflowCommit,
        "registry.example/steward-run",
        jobContainerImage,
      ],
      { cwd: repository },
    );
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), {
      schemaVersion: 4,
      version: "0.2.0",
      action_commit: actionCommit,
      workflow_commit: workflowCommit,
      action: { commit: actionCommit },
      reusableWorkflow: {
        repository: "apelogic-ai/steward-run",
        path: ".github/workflows/steward-task.yml",
        commit: workflowCommit,
        immutableReference:
          `apelogic-ai/steward-run/.github/workflows/steward-task.yml@${workflowCommit}`,
      },
      runnerImage: {
        role: "arc-runner",
        repository: "registry.example/steward-run",
        digest,
        immutableReference: `registry.example/steward-run@${digest}`,
      },
      governedJobContainerImage: {
        repository: "registry.example/steward-run",
        digest: jobContainerDigest,
        immutableReference: jobContainerImage,
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release manifest generation rejects invalid build metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-release-invalid-"));
  const metadata = join(root, "build-metadata.json");
  try {
    await writeFile(metadata, JSON.stringify({ "containerimage.digest": "latest" }), "utf8");
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          "scripts/write-release-manifest.mjs",
          metadata,
          join(root, "release-manifest.json"),
          "0.2.0",
          "b".repeat(40),
          "d".repeat(40),
          "registry.example/steward-run",
          jobContainerImage,
        ],
        { cwd: repository },
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release manifest rejects mutable or caller-controlled job-container references", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-release-container-invalid-"));
  const metadata = join(root, "build-metadata.json");
  try {
    await writeFile(
      metadata,
      JSON.stringify({ "containerimage.digest": `sha256:${"a".repeat(64)}` }),
      "utf8",
    );
    for (const reference of [
      "registry.example/steward-run:0.3.0",
      "${{ inputs.job-container-image }}",
      "registry.example/steward-run@sha256:short",
    ]) {
      await assert.rejects(
        execFileAsync(
          process.execPath,
          [
            "scripts/write-release-manifest.mjs",
            metadata,
            join(root, "release-manifest.json"),
            "0.3.1",
            "b".repeat(40),
            "d".repeat(40),
            "registry.example/steward-run",
            reference,
          ],
          { cwd: repository },
        ),
        /governed job-container image is invalid/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release manifest requires distinct immutable action and workflow commits", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-release-commits-invalid-"));
  const metadata = join(root, "build-metadata.json");
  const commit = "b".repeat(40);
  try {
    await writeFile(
      metadata,
      JSON.stringify({ "containerimage.digest": `sha256:${"a".repeat(64)}` }),
      "utf8",
    );
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          "scripts/write-release-manifest.mjs",
          metadata,
          join(root, "release-manifest.json"),
          "0.3.4",
          commit,
          commit,
          "registry.example/steward-run",
          jobContainerImage,
        ],
        { cwd: repository },
      ),
      /action and workflow commits must differ/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
