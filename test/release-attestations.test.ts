import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repository = new URL("..", import.meta.url);
const indexMediaType = "application/vnd.oci.image.index.v1+json";
const imageManifestMediaType = "application/vnd.oci.image.manifest.v1+json";
const attestationManifestType = "application/vnd.docker.attestation.manifest.v1+json";
const statementMediaType = "application/vnd.in-toto+json";
const provenancePredicate = "https://slsa.dev/provenance/v1";
const spdxPredicate = "https://spdx.dev/Document";

type FixtureDefect =
  | "duplicate-attestation"
  | "duplicate-predicate"
  | "mismatched-subject"
  | "missing-provenance"
  | "wrong-predicate";

function bytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

function descriptor(content: Buffer, mediaType: string): { digest: string; mediaType: string; size: number } {
  return {
    digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    mediaType,
    size: content.byteLength,
  };
}

async function writeBlob(layout: string, content: Buffer): Promise<ReturnType<typeof descriptor>> {
  const result = descriptor(content, "");
  await writeFile(join(layout, "blobs", "sha256", result.digest.slice("sha256:".length)), content);
  return result;
}

async function createFixture(
  root: string,
  defect?: FixtureDefect,
  architectures = ["amd64", "arm64"],
) {
  const layout = join(root, "oci");
  await mkdir(join(layout, "blobs", "sha256"), { recursive: true });
  await writeFile(join(layout, "oci-layout"), JSON.stringify({ imageLayoutVersion: "1.0.0" }));

  const rootManifests: Array<Record<string, unknown>> = [];
  for (const architecture of architectures) {
    const runnableContent = bytes({
      schemaVersion: 2,
      mediaType: imageManifestMediaType,
      config: {
        mediaType: "application/vnd.oci.image.config.v1+json",
        digest: `sha256:${architecture === "amd64" ? "a".repeat(64) : "b".repeat(64)}`,
        size: 2,
      },
      layers: [],
    });
    const runnable = descriptor(runnableContent, imageManifestMediaType);
    await writeBlob(layout, runnableContent);
    rootManifests.push({ ...runnable, platform: { os: "linux", architecture } });

    const makeStatement = (predicateType: string) => bytes({
      _type: "https://in-toto.io/Statement/v1",
      subject: [],
      predicateType,
      predicate: predicateType === spdxPredicate
        ? { spdxVersion: "SPDX-2.3", SPDXID: "SPDXRef-DOCUMENT" }
        : { buildDefinition: {}, runDetails: {} },
    });
    const predicateTypes = [provenancePredicate, spdxPredicate];
    if (architecture === "amd64" && defect === "missing-provenance") predicateTypes.shift();
    if (architecture === "amd64" && defect === "wrong-predicate") predicateTypes[0] = "https://example.invalid/predicate";
    if (architecture === "amd64" && defect === "duplicate-predicate") predicateTypes[1] = provenancePredicate;

    const layers = [];
    for (const predicateType of predicateTypes) {
      const statement = makeStatement(predicateType);
      const statementDescriptor = descriptor(statement, statementMediaType);
      await writeBlob(layout, statement);
      layers.push({
        ...statementDescriptor,
        annotations: { "in-toto.io/predicate-type": predicateType },
      });
    }
    const subjectDigest = architecture === "amd64" && defect === "mismatched-subject"
      ? `sha256:${"f".repeat(64)}`
      : runnable.digest;
    const attestationContent = bytes({
      schemaVersion: 2,
      mediaType: imageManifestMediaType,
      artifactType: attestationManifestType,
      subject: { ...runnable, digest: subjectDigest },
      config: { mediaType: "application/vnd.oci.empty.v1+json", digest: `sha256:${"e".repeat(64)}`, size: 2 },
      layers,
    });
    const attestation = descriptor(attestationContent, imageManifestMediaType);
    await writeBlob(layout, attestationContent);
    const attestationIndexDescriptor = {
      ...attestation,
      platform: { os: "unknown", architecture: "unknown" },
      annotations: {
        "vnd.docker.reference.type": "attestation-manifest",
        "vnd.docker.reference.digest": runnable.digest,
      },
    };
    rootManifests.push(attestationIndexDescriptor);
    if (architecture === "amd64" && defect === "duplicate-attestation") {
      rootManifests.push(attestationIndexDescriptor);
    }
  }

  const indexContent = bytes({ schemaVersion: 2, mediaType: indexMediaType, manifests: rootManifests });
  const indexDescriptor = descriptor(indexContent, indexMediaType);
  await writeBlob(layout, indexContent);
  await writeFile(
    join(layout, "index.json"),
    JSON.stringify({ schemaVersion: 2, mediaType: indexMediaType, manifests: [indexDescriptor] }),
  );
  const registryManifest = join(root, "registry-index.json");
  await writeFile(registryManifest, indexContent);
  return { layout, registryManifest, imageDigest: indexDescriptor.digest };
}

async function verify(defect?: FixtureDefect) {
  const root = await mkdtemp(join(tmpdir(), "steward-run-attestations-"));
  const fixture = await createFixture(root, defect);
  const output = join(root, "summary.json");
  const execution = execFileAsync(
    process.execPath,
    [
      "scripts/verify-release-attestations.mjs",
      fixture.registryManifest,
      fixture.layout,
      fixture.imageDigest,
      output,
      "linux/amd64",
      "linux/arm64",
    ],
    { cwd: repository },
  );
  return { execution, fixture, output, root };
}

test("release attestation verification binds provenance and SPDX to each runnable child", async () => {
  const { execution, fixture, output, root } = await verify();
  try {
    await execution;
    const summary = JSON.parse(await readFile(output, "utf8"));
    assert.equal(summary.schemaVersion, 1);
    assert.equal(summary.imageDigest, fixture.imageDigest);
    assert.deepEqual(summary.platforms.map((entry: { platform: string }) => entry.platform), ["linux/amd64", "linux/arm64"]);
    for (const platform of summary.platforms) {
      assert.match(platform.runnableDigest, /^sha256:[a-f0-9]{64}$/u);
      assert.deepEqual(platform.predicates.map((entry: { predicateType: string }) => entry.predicateType), [provenancePredicate, spdxPredicate]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release index assembly preserves both native children and their attestations", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-index-"));
  try {
    const amd64 = await createFixture(join(root, "amd64"), undefined, ["amd64"]);
    const arm64 = await createFixture(join(root, "arm64"), undefined, ["arm64"]);
    const outputLayout = join(root, "release-oci");
    const outputManifest = join(root, "release-index.json");
    const outputMetadata = join(root, "release-metadata.json");
    await execFileAsync(
      process.execPath,
      [
        "scripts/assemble-release-index.mjs",
        outputLayout,
        outputManifest,
        outputMetadata,
        `linux/amd64=${amd64.layout}`,
        `linux/arm64=${arm64.layout}`,
      ],
      { cwd: repository },
    );
    const metadata = JSON.parse(await readFile(outputMetadata, "utf8"));
    await execFileAsync(
      process.execPath,
      [
        "scripts/verify-release-attestations.mjs",
        outputManifest,
        outputLayout,
        metadata["containerimage.digest"],
        join(root, "summary.json"),
        "linux/amd64",
        "linux/arm64",
      ],
      { cwd: repository },
    );
    assert.equal(
      `sha256:${createHash("sha256").update(await readFile(outputManifest)).digest("hex")}`,
      metadata["containerimage.digest"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const [defect, message] of [
  ["missing-provenance", "exactly one provenance and one SPDX"],
  ["mismatched-subject", "subject does not match runnable"],
  ["wrong-predicate", "unexpected attestation predicate"],
  ["duplicate-predicate", "exactly one provenance and one SPDX"],
  ["duplicate-attestation", "exactly one attestation manifest"],
] as const) {
  test(`release attestation verification rejects ${defect}`, async () => {
    const { execution, root } = await verify(defect);
    try {
      await assert.rejects(execution, new RegExp(message, "u"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
