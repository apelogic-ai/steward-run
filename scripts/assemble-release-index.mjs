import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [outputLayout, outputManifest, outputMetadata, ...platformSources] = process.argv.slice(2);
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const hexPattern = /^[a-f0-9]{64}$/u;
const indexMediaType = "application/vnd.oci.image.index.v1+json";
const imageManifestMediaType = "application/vnd.oci.image.manifest.v1+json";

if (!outputLayout || !outputManifest || !outputMetadata || platformSources.length === 0) {
  throw new Error(
    "usage: assemble-release-index <output-layout> <output-manifest> <output-metadata> <os/architecture=oci-layout>...",
  );
}

function digest(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function parseJson(content, label) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
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

async function loadBlob(layout, descriptor, label) {
  validateDescriptor(descriptor, label);
  const content = await readFile(
    join(layout, "blobs", "sha256", descriptor.digest.slice("sha256:".length)),
  );
  if (digest(content) !== descriptor.digest || content.byteLength !== descriptor.size) {
    throw new Error(`${label} blob does not match its content-addressed descriptor`);
  }
  return content;
}

const sources = platformSources.map((value) => {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`platform source is invalid: ${value}`);
  }
  const platform = value.slice(0, separator);
  const layout = value.slice(separator + 1);
  if (!/^[a-z0-9]+\/[a-z0-9]+$/u.test(platform)) {
    throw new Error(`platform source is invalid: ${value}`);
  }
  return { platform, layout };
});
sources.sort((left, right) => left.platform.localeCompare(right.platform));
if (new Set(sources.map(({ platform }) => platform)).size !== sources.length) {
  throw new Error("platform sources must be unique");
}

await mkdir(join(outputLayout, "blobs", "sha256"), { recursive: true });
await writeFile(
  join(outputLayout, "oci-layout"),
  `${JSON.stringify({ imageLayoutVersion: "1.0.0" })}\n`,
  "utf8",
);

const manifests = [];
for (const { platform, layout } of sources) {
  const declaration = parseJson(
    await readFile(join(layout, "oci-layout"), "utf8"),
    `${platform} OCI layout declaration`,
  );
  if (declaration.imageLayoutVersion !== "1.0.0") {
    throw new Error(`${platform} OCI layout version must be 1.0.0`);
  }
  const layoutIndex = parseJson(
    await readFile(join(layout, "index.json"), "utf8"),
    `${platform} OCI layout index`,
  );
  if (!Array.isArray(layoutIndex.manifests) || layoutIndex.manifests.length !== 1) {
    throw new Error(`${platform} OCI layout must contain exactly one root descriptor`);
  }
  const sourceRootDescriptor = layoutIndex.manifests[0];
  if (sourceRootDescriptor.mediaType !== indexMediaType) {
    throw new Error(`${platform} OCI root must be an image index`);
  }
  const sourceRoot = parseJson(
    await loadBlob(layout, sourceRootDescriptor, `${platform} root index`),
    `${platform} root index`,
  );
  if (sourceRoot.mediaType !== indexMediaType || !Array.isArray(sourceRoot.manifests)) {
    throw new Error(`${platform} root index is malformed`);
  }
  const [operatingSystem, architecture] = platform.split("/");
  const runnable = sourceRoot.manifests.filter(
    (entry) => entry?.annotations?.["vnd.docker.reference.type"] !== "attestation-manifest",
  );
  const attestations = sourceRoot.manifests.filter(
    (entry) => entry?.annotations?.["vnd.docker.reference.type"] === "attestation-manifest",
  );
  if (
    runnable.length !== 1 ||
    runnable[0]?.platform?.os !== operatingSystem ||
    runnable[0]?.platform?.architecture !== architecture
  ) {
    throw new Error(`${platform} source must contain exactly its native runnable manifest`);
  }
  validateDescriptor(runnable[0], `${platform} runnable`);
  if (runnable[0].mediaType !== imageManifestMediaType) {
    throw new Error(`${platform} runnable must be an OCI image manifest`);
  }
  if (
    attestations.length !== 1 ||
    attestations[0]?.annotations?.["vnd.docker.reference.digest"] !== runnable[0].digest
  ) {
    throw new Error(`${platform} source must contain exactly one bound attestation manifest`);
  }
  validateDescriptor(attestations[0], `${platform} attestation`);
  manifests.push(runnable[0], attestations[0]);

  const sourceBlobDirectory = join(layout, "blobs", "sha256");
  for (const file of await readdir(sourceBlobDirectory)) {
    if (!hexPattern.test(file)) throw new Error(`${platform} OCI layout contains an invalid blob name`);
    const sourcePath = join(sourceBlobDirectory, file);
    if (!(await lstat(sourcePath)).isFile()) {
      throw new Error(`${platform} OCI layout blob is not a regular file`);
    }
    const content = await readFile(sourcePath);
    if (digest(content) !== `sha256:${file}`) {
      throw new Error(`${platform} OCI layout contains a corrupt blob`);
    }
    await writeFile(join(outputLayout, "blobs", "sha256", file), content, { flag: "wx" })
      .catch(async (error) => {
        if (error?.code !== "EEXIST") throw error;
        const existing = await readFile(join(outputLayout, "blobs", "sha256", file));
        if (!existing.equals(content)) throw new Error(`conflicting OCI blob: sha256:${file}`);
      });
  }
}

const indexContent = Buffer.from(
  JSON.stringify({ schemaVersion: 2, mediaType: indexMediaType, manifests }),
);
const indexDigest = digest(indexContent);
const indexDescriptor = {
  mediaType: indexMediaType,
  digest: indexDigest,
  size: indexContent.byteLength,
};
await writeFile(outputManifest, indexContent);
await writeFile(
  join(outputLayout, "blobs", "sha256", indexDigest.slice("sha256:".length)),
  indexContent,
);
await writeFile(
  join(outputLayout, "index.json"),
  `${JSON.stringify({ schemaVersion: 2, mediaType: indexMediaType, manifests: [indexDescriptor] })}\n`,
  "utf8",
);
await writeFile(
  outputMetadata,
  `${JSON.stringify({ "containerimage.digest": indexDigest }, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${indexDigest}\n`);
