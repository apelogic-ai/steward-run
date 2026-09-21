import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [registryIndexPath, layoutPath, imageDigest, outputPath, ...expectedPlatforms] =
  process.argv.slice(2);
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const imageIndexMediaType = "application/vnd.oci.image.index.v1+json";
const imageManifestMediaType = "application/vnd.oci.image.manifest.v1+json";
const attestationArtifactType = "application/vnd.docker.attestation.manifest.v1+json";
const statementMediaType = "application/vnd.in-toto+json";
const provenancePredicate = "https://slsa.dev/provenance/v1";
const spdxPredicate = "https://spdx.dev/Document";
const requiredPredicates = [provenancePredicate, spdxPredicate];

if (
  !registryIndexPath ||
  !layoutPath ||
  !imageDigest ||
  !outputPath ||
  expectedPlatforms.length === 0
) {
  throw new Error(
    "usage: verify-release-attestations <registry-index> <oci-layout> <image-digest> <output> <os/architecture>...",
  );
}
if (!digestPattern.test(imageDigest)) throw new Error("image digest is invalid");
const expected = [...new Set(expectedPlatforms)].sort();
if (
  expected.length !== expectedPlatforms.length ||
  expected.some((platform) => !/^[a-z0-9]+\/[a-z0-9]+$/u.test(platform))
) {
  throw new Error("expected runnable platforms are invalid or duplicated");
}

function parseJson(content, label) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

function validateDescriptor(descriptor, label) {
  if (
    descriptor === null ||
    typeof descriptor !== "object" ||
    !digestPattern.test(descriptor.digest) ||
    !Number.isSafeInteger(descriptor.size) ||
    descriptor.size < 0 ||
    typeof descriptor.mediaType !== "string"
  ) {
    throw new Error(`${label} descriptor is malformed`);
  }
}

async function loadBlob(descriptor, label) {
  validateDescriptor(descriptor, label);
  const [algorithm, hex] = descriptor.digest.split(":");
  const content = await readFile(join(layoutPath, "blobs", algorithm, hex));
  const actualDigest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (actualDigest !== descriptor.digest || content.byteLength !== descriptor.size) {
    throw new Error(`${label} blob does not match its content-addressed descriptor`);
  }
  return content;
}

const layoutDeclaration = parseJson(
  await readFile(join(layoutPath, "oci-layout"), "utf8"),
  "OCI layout declaration",
);
if (layoutDeclaration.imageLayoutVersion !== "1.0.0") {
  throw new Error("OCI layout version must be 1.0.0");
}
const layoutIndex = parseJson(
  await readFile(join(layoutPath, "index.json"), "utf8"),
  "OCI layout index",
);
if (!Array.isArray(layoutIndex.manifests)) throw new Error("OCI layout index is malformed");
const rootDescriptors = layoutIndex.manifests.filter(
  (descriptor) => descriptor?.digest === imageDigest,
);
if (rootDescriptors.length !== 1) {
  throw new Error("OCI layout must contain exactly one descriptor for the released image digest");
}
const rootDescriptor = rootDescriptors[0];
if (rootDescriptor.mediaType !== imageIndexMediaType) {
  throw new Error("released image descriptor must be an OCI image index");
}
const rootContent = await loadBlob(rootDescriptor, "released image index");
const rootIndex = parseJson(rootContent, "released image index");
const registryIndex = parseJson(
  await readFile(registryIndexPath, "utf8"),
  "registry image index",
);
if (JSON.stringify(canonical(rootIndex)) !== JSON.stringify(canonical(registryIndex))) {
  throw new Error("registry image index does not match the content-addressed OCI layout");
}
if (
  rootIndex.mediaType !== imageIndexMediaType ||
  !Array.isArray(rootIndex.manifests)
) {
  throw new Error("released image index is malformed");
}

const attestationDescriptors = rootIndex.manifests.filter(
  (manifest) =>
    manifest?.annotations?.["vnd.docker.reference.type"] === "attestation-manifest",
);
const runnableDescriptors = rootIndex.manifests.filter(
  (manifest) =>
    manifest?.annotations?.["vnd.docker.reference.type"] !== "attestation-manifest",
);
const runnableByPlatform = new Map();
for (const runnable of runnableDescriptors) {
  validateDescriptor(runnable, "runnable image");
  if (runnable.mediaType !== imageManifestMediaType) {
    throw new Error("runnable image must be an OCI image manifest");
  }
  const operatingSystem = runnable?.platform?.os;
  const architecture = runnable?.platform?.architecture;
  if (typeof operatingSystem !== "string" || typeof architecture !== "string") {
    throw new Error("runnable image platform is malformed");
  }
  const platform = `${operatingSystem}/${architecture}`;
  if (runnableByPlatform.has(platform)) throw new Error(`duplicate runnable platform: ${platform}`);
  runnableByPlatform.set(platform, runnable);
}
const actualPlatforms = [...runnableByPlatform.keys()].sort();
if (
  actualPlatforms.length !== expected.length ||
  actualPlatforms.some((platform, index) => platform !== expected[index])
) {
  throw new Error(
    `OCI index runnable platforms must be exactly: ${expected.join(", ")}; found: ${actualPlatforms.join(", ") || "none"}`,
  );
}

const summaries = [];
for (const platform of expected) {
  const runnable = runnableByPlatform.get(platform);
  const candidates = attestationDescriptors.filter(
    (manifest) =>
      manifest?.annotations?.["vnd.docker.reference.digest"] === runnable.digest,
  );
  if (candidates.length !== 1) {
    throw new Error(
      `${platform} must have exactly one attestation manifest; found ${candidates.length} for ${runnable.digest}`,
    );
  }
  const attestationDescriptor = candidates[0];
  validateDescriptor(attestationDescriptor, `${platform} attestation`);
  if (attestationDescriptor.mediaType !== imageManifestMediaType) {
    throw new Error(`${platform} attestation descriptor has an invalid media type`);
  }
  const attestation = parseJson(
    await loadBlob(attestationDescriptor, `${platform} attestation`),
    `${platform} attestation manifest`,
  );
  if (
    attestation.mediaType !== imageManifestMediaType ||
    attestation.artifactType !== attestationArtifactType ||
    !Array.isArray(attestation.layers)
  ) {
    throw new Error(`${platform} attestation manifest is malformed`);
  }
  if (
    attestation?.subject?.digest !== runnable.digest ||
    attestation?.subject?.mediaType !== runnable.mediaType ||
    attestation?.subject?.size !== runnable.size
  ) {
    throw new Error(`${platform} attestation subject does not match runnable image`);
  }

  const predicates = [];
  for (const layer of attestation.layers) {
    validateDescriptor(layer, `${platform} attestation layer`);
    if (layer.mediaType !== statementMediaType) {
      throw new Error(`${platform} attestation layer has an invalid media type`);
    }
    const annotatedPredicate = layer?.annotations?.["in-toto.io/predicate-type"];
    if (!requiredPredicates.includes(annotatedPredicate)) {
      throw new Error(`${platform} has unexpected attestation predicate: ${annotatedPredicate ?? "missing"}`);
    }
    const statement = parseJson(
      await loadBlob(layer, `${platform} ${annotatedPredicate} statement`),
      `${platform} ${annotatedPredicate} statement`,
    );
    if (
      statement._type !== "https://in-toto.io/Statement/v1" ||
      statement.predicateType !== annotatedPredicate ||
      statement.predicate === null ||
      typeof statement.predicate !== "object" ||
      !Array.isArray(statement.subject)
    ) {
      throw new Error(`${platform} ${annotatedPredicate} statement is malformed`);
    }
    if (statement.subject.length === 0) {
      throw new Error(`${platform} ${annotatedPredicate} statement must identify the runnable image`);
    }
    for (const subject of statement.subject) {
      if (subject?.digest?.sha256 !== runnable.digest.slice("sha256:".length)) {
        throw new Error(`${platform} statement subject does not match runnable image`);
      }
    }
    if (
      annotatedPredicate === provenancePredicate &&
      (statement.predicate.buildDefinition === null ||
        typeof statement.predicate.buildDefinition !== "object" ||
        statement.predicate.runDetails === null ||
        typeof statement.predicate.runDetails !== "object")
    ) {
      throw new Error(`${platform} provenance predicate is malformed`);
    }
    if (
      annotatedPredicate === spdxPredicate &&
      (typeof statement.predicate.spdxVersion !== "string" ||
        !statement.predicate.spdxVersion.startsWith("SPDX-") ||
        typeof statement.predicate.SPDXID !== "string")
    ) {
      throw new Error(`${platform} SPDX predicate is malformed`);
    }
    predicates.push({ predicateType: annotatedPredicate, statementDigest: layer.digest });
  }
  predicates.sort((left, right) => left.predicateType.localeCompare(right.predicateType));
  if (
    predicates.length !== requiredPredicates.length ||
    predicates.some((entry, index) => entry.predicateType !== requiredPredicates[index])
  ) {
    throw new Error(`${platform} must have exactly one provenance and one SPDX attestation`);
  }
  summaries.push({
    platform,
    runnableDigest: runnable.digest,
    attestationManifestDigest: attestationDescriptor.digest,
    predicates,
  });
}
if (attestationDescriptors.length !== summaries.length) {
  throw new Error("OCI index contains an attestation manifest not bound to an expected runnable image");
}

await writeFile(
  outputPath,
  `${JSON.stringify({ schemaVersion: 1, imageDigest, platforms: summaries }, null, 2)}\n`,
  "utf8",
);
