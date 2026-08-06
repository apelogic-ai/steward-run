import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repository = new URL("..", import.meta.url);

test("release manifest binds the action commit to the immutable runner image digest", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-release-"));
  const metadata = join(root, "build-metadata.json");
  const output = join(root, "release-manifest.json");
  const digest = `sha256:${"a".repeat(64)}`;
  const commit = "b".repeat(40);
  try {
    await writeFile(metadata, JSON.stringify({ "containerimage.digest": digest }), "utf8");
    await execFileAsync(
      process.execPath,
      [
        "scripts/write-release-manifest.mjs",
        metadata,
        output,
        "0.2.0",
        commit,
        "registry.example/steward-run",
      ],
      { cwd: repository },
    );
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), {
      schemaVersion: 2,
      version: "0.2.0",
      action: { commit },
      reusableWorkflow: {
        repository: "apelogic-ai/steward-run",
        path: ".github/workflows/steward-task.yml",
        commit,
        immutableReference:
          `apelogic-ai/steward-run/.github/workflows/steward-task.yml@${commit}`,
      },
      runnerImage: {
        repository: "registry.example/steward-run",
        digest,
        immutableReference: `registry.example/steward-run@${digest}`,
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
          "registry.example/steward-run",
        ],
        { cwd: repository },
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
