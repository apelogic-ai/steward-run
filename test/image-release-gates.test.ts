import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repository = new URL("..", import.meta.url);

function encoded(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

function digest(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

test("combined bootstrap index is bound to both exact native build outputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-bootstrap-index-"));
  const descriptor = (seed: string, architecture: string, attestation = false) => ({
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    digest: `sha256:${seed.repeat(64)}`,
    size: 123,
    platform: { os: attestation ? "unknown" : "linux", architecture: attestation ? "unknown" : architecture },
    ...(attestation
      ? { annotations: { "vnd.docker.reference.type": "attestation-manifest" } }
      : {}),
  });
  const amd64 = encoded({ manifests: [descriptor("a", "amd64"), descriptor("b", "amd64", true)] });
  const arm64 = encoded({ manifests: [descriptor("c", "arm64"), descriptor("d", "arm64", true)] });
  const combined = encoded({
    manifests: [
      descriptor("d", "arm64", true),
      descriptor("a", "amd64"),
      descriptor("c", "arm64"),
      descriptor("b", "amd64", true),
    ],
  });
  const paths = {
    combined: join(root, "combined.json"),
    amd64: join(root, "amd64.json"),
    arm64: join(root, "arm64.json"),
  };
  try {
    await writeFile(paths.combined, combined);
    await writeFile(paths.amd64, amd64);
    await writeFile(paths.arm64, arm64);
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "scripts/verify-combined-image-index.mjs",
        paths.combined,
        paths.amd64,
        digest(amd64),
        paths.arm64,
        digest(arm64),
      ],
      { cwd: repository },
    );
    assert.equal(stdout.trim(), digest(combined));

    await writeFile(paths.combined, encoded({ manifests: [descriptor("a", "amd64")] }));
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          "scripts/verify-combined-image-index.mjs",
          paths.combined,
          paths.amd64,
          digest(amd64),
          paths.arm64,
          digest(arm64),
        ],
        { cwd: repository },
      ),
      /not exactly the manifests/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release image labels bind both platforms to version, source, and one revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-image-labels-"));
  const metadata = join(root, "metadata.json");
  const revision = "a".repeat(40);
  const source = "https://github.com/example/steward-run";
  const image = (architecture: string, overrides: Record<string, string> = {}) => ({
    architecture,
    os: "linux",
    config: {
      Labels: {
        "org.opencontainers.image.version": "0.7.6",
        "org.opencontainers.image.source": source,
        "org.opencontainers.image.revision": revision,
        ...overrides,
      },
    },
  });
  try {
    await writeFile(
      metadata,
      JSON.stringify({ "linux/amd64": image("amd64"), "linux/arm64": image("arm64") }),
    );
    const { stdout } = await execFileAsync(
      process.execPath,
      ["scripts/verify-image-release-labels.mjs", metadata, "0.7.6", source],
      { cwd: repository },
    );
    assert.equal(stdout.trim(), revision);

    for (const labels of [
      { "org.opencontainers.image.version": "0.7.5" },
      { "org.opencontainers.image.source": "https://github.com/other/steward-run" },
      { "org.opencontainers.image.revision": "b".repeat(40) },
    ]) {
      await writeFile(
        metadata,
        JSON.stringify({
          "linux/amd64": image("amd64"),
          "linux/arm64": image("arm64", labels),
        }),
      );
      await assert.rejects(
        execFileAsync(
          process.execPath,
          ["scripts/verify-image-release-labels.mjs", metadata, "0.7.6", source],
          { cwd: repository },
        ),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
