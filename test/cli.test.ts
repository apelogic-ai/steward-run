import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseCallerOptions,
  validateIdempotencyKey,
  validateOutputsFileOption,
  validateWorkspaceOption,
} from "../src/cli.ts";

test("caller flags accept explicit non-empty values", () => {
  assert.deepEqual(
    parseCallerOptions([
      "--idempotency-key",
      "caller-key",
      "--workspace",
      "/workspace",
      "--outputs-file",
      "results/outputs",
    ]),
    {
      idempotencyKey: "caller-key",
      workspace: "/workspace",
      outputsFile: "results/outputs",
    },
  );
  assert.throws(() => parseCallerOptions(["--idempotency-key", ""]), /must not be empty/u);
});

test("an explicit idempotency key must be bounded and use safe characters", () => {
  assert.equal(validateIdempotencyKey("release-summary.v1:retry_2"), "release-summary.v1:retry_2");
  assert.equal(validateIdempotencyKey("a".repeat(128)), "a".repeat(128));
  for (const invalid of ["a".repeat(129), "has space", "slash/key", "new\nline", "caf\u00e9", ""]) {
    assert.throws(() => validateIdempotencyKey(invalid), /idempotency-key must be/u, invalid);
    assert.throws(
      () => parseCallerOptions(["--idempotency-key", invalid]),
      /idempotency-key must/u,
      invalid,
    );
  }
});

test("workspace and outputs-file flags reject symbolic-link traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-cli-"));
  const workspace = join(root, "workspace");
  const outside = join(root, "outside");
  try {
    await mkdir(workspace);
    await mkdir(outside);
    await symlink(workspace, join(root, "workspace-link"), "dir");
    await symlink(outside, join(workspace, "redirect"), "dir");

    await assert.rejects(
      validateWorkspaceOption(join(root, "workspace-link")),
      /must not be a symbolic link/u,
    );
    await assert.rejects(
      validateOutputsFileOption(workspace, "redirect/outputs"),
      /must not contain symbolic links/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("outputs-file stays inside the workspace and may create its final file", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "steward-run-cli-output-"));
  try {
    await mkdir(join(workspace, "results"));
    assert.equal(
      await validateOutputsFileOption(workspace, "results/outputs"),
      join(workspace, "results", "outputs"),
    );
    await writeFile(join(workspace, "results", "existing"), "");
    assert.equal(
      await validateOutputsFileOption(workspace, "results/existing"),
      join(workspace, "results", "existing"),
    );
    await assert.rejects(
      validateOutputsFileOption(workspace, "../outputs"),
      /inside the workspace/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
