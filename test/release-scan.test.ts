import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = new URL("..", import.meta.url);
const indexDigest = `sha256:${"a".repeat(64)}`;
const runnableDigest = `sha256:${"b".repeat(64)}`;
const attestationDigest = `sha256:${"c".repeat(64)}`;

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "steward-run-release-scan-"));
}

test("release scan resolves the one runnable platform manifest", async () => {
  const root = await temporaryDirectory();
  const manifest = join(root, "index.json");
  try {
    await writeFile(
      manifest,
      JSON.stringify({
        manifests: [
          {
            digest: runnableDigest,
            platform: { os: "linux", architecture: "amd64" },
          },
          {
            digest: attestationDigest,
            platform: { os: "unknown", architecture: "unknown" },
            annotations: { "vnd.docker.reference.type": "attestation-manifest" },
          },
        ],
      }),
      "utf8",
    );
    const { stdout } = await execFileAsync(
      process.execPath,
      ["scripts/resolve-runnable-image-digest.mjs", manifest, "linux", "amd64"],
      { cwd: repositoryRoot },
    );
    assert.equal(stdout, runnableDigest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release scan rejects missing or ambiguous runnable manifests", async () => {
  const root = await temporaryDirectory();
  const manifest = join(root, "index.json");
  try {
    for (const manifests of [
      [],
      [
        { digest: runnableDigest, platform: { os: "linux", architecture: "amd64" } },
        { digest: attestationDigest, platform: { os: "linux", architecture: "amd64" } },
      ],
    ]) {
      await writeFile(manifest, JSON.stringify({ manifests }), "utf8");
      await assert.rejects(
        execFileAsync(
          process.execPath,
          ["scripts/resolve-runnable-image-digest.mjs", manifest, "linux", "amd64"],
          { cwd: repositoryRoot },
        ),
        /exactly one runnable linux\/amd64 manifest/u,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release scan summary binds completed findings to both immutable digests", async () => {
  const root = await temporaryDirectory();
  const findings = join(root, "findings.json");
  const output = join(root, "summary.json");
  try {
    await writeFile(
      findings,
      JSON.stringify({
        repositoryName: "steward-run",
        imageId: { imageDigest: runnableDigest },
        imageScanStatus: { status: "COMPLETE" },
        imageScanFindings: {
          findingSeverityCounts: { MEDIUM: 2, CRITICAL: 0 },
          imageScanCompletedAt: "2026-08-23T17:16:08-07:00",
          vulnerabilitySourceUpdatedAt: "2026-08-23T17:16:08-07:00",
        },
      }),
      "utf8",
    );
    await execFileAsync(
      process.execPath,
      [
        "scripts/write-ecr-scan-summary.mjs",
        findings,
        output,
        "steward-run",
        indexDigest,
        runnableDigest,
      ],
      { cwd: repositoryRoot },
    );
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), {
      schemaVersion: 1,
      provider: "aws-ecr",
      repository: "steward-run",
      indexDigest,
      runnableImage: {
        operatingSystem: "linux",
        architecture: "amd64",
        digest: runnableDigest,
      },
      status: "COMPLETE",
      findingSeverityCounts: { CRITICAL: 0, MEDIUM: 2 },
      completedAt: "2026-08-23T17:16:08-07:00",
      vulnerabilitySourceUpdatedAt: "2026-08-23T17:16:08-07:00",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release scan summary fails closed for incomplete or mismatched scans", async () => {
  const root = await temporaryDirectory();
  const findings = join(root, "findings.json");
  try {
    for (const scan of [
      {
        repositoryName: "steward-run",
        imageId: { imageDigest: runnableDigest },
        imageScanStatus: { status: "IN_PROGRESS" },
      },
      {
        repositoryName: "other-repository",
        imageId: { imageDigest: runnableDigest },
        imageScanStatus: { status: "COMPLETE" },
      },
      {
        repositoryName: "steward-run",
        imageId: { imageDigest: attestationDigest },
        imageScanStatus: { status: "COMPLETE" },
      },
    ]) {
      await writeFile(findings, JSON.stringify(scan), "utf8");
      await assert.rejects(
        execFileAsync(
          process.execPath,
          [
            "scripts/write-ecr-scan-summary.mjs",
            findings,
            join(root, "summary.json"),
            "steward-run",
            indexDigest,
            runnableDigest,
          ],
          { cwd: repositoryRoot },
        ),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
