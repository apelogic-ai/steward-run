import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { checkPublicReleaseAssets } from "../scripts/check-public-release-assets.mjs";

const execFileAsync = promisify(execFile);
const privateRegistry = `${"123456".repeat(2)}.${["dkr", "ecr"].join(".")}.us-east-1.amazonaws.com/private/steward-run`;

test("public release asset check accepts curated public files and packaged charts", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-public-assets-"));
  const assets = join(root, "assets");
  const chart = join(root, "chart");
  try {
    await mkdir(assets);
    await mkdir(chart);
    await writeFile(join(assets, "oss-release-manifest.json"), '{"image":"ghcr.io/example/steward-run@sha256:abc"}\n');
    await writeFile(join(chart, "values.yaml"), "image: ghcr.io/example/steward-run@sha256:abc\n");
    await execFileAsync("tar", ["-czf", join(assets, "chart.tgz"), "-C", chart, "."]);
    await assert.doesNotReject(checkPublicReleaseAssets([assets]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public release asset check rejects private references in text and packaged charts", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-private-assets-"));
  const chart = join(root, "chart");
  try {
    await writeFile(join(root, "handoff.json"), `${privateRegistry}\n`);
    await assert.rejects(checkPublicReleaseAssets([join(root, "handoff.json")]), /AWS ECR registry/u);

    await mkdir(chart);
    await writeFile(join(chart, "values.yaml"), `image: ${privateRegistry}\n`);
    const archive = join(root, "chart.tgz");
    await execFileAsync("tar", ["-czf", archive, "-C", chart, "."]);
    await assert.rejects(checkPublicReleaseAssets([archive]), /chart\.tgz/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public release asset check rejects symlink indirection", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-public-symlink-"));
  try {
    const target = join(root, "target.txt");
    const link = join(root, "asset.txt");
    await writeFile(target, "public\n");
    await symlink(target, link);
    await assert.rejects(checkPublicReleaseAssets([link]), /must not be a symlink/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
