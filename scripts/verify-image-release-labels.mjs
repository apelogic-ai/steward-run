import { readFile } from "node:fs/promises";

const [imageMetadataPath, expectedVersion, expectedSource] = process.argv.slice(2);
if (!imageMetadataPath || !expectedVersion || !expectedSource) {
  throw new Error(
    "usage: verify-image-release-labels <image-metadata> <expected-version> <expected-source>",
  );
}

let images;
try {
  images = JSON.parse(await readFile(imageMetadataPath, "utf8"));
} catch {
  throw new Error("image metadata is not valid JSON");
}
if (images === null || typeof images !== "object" || Array.isArray(images)) {
  throw new Error("image metadata must be an object keyed by platform");
}

const expectedPlatforms = ["linux/amd64", "linux/arm64"];
const platforms = Object.keys(images).sort();
if (
  platforms.length !== expectedPlatforms.length ||
  platforms.some((platform, index) => platform !== expectedPlatforms[index])
) {
  throw new Error(`image metadata platforms must be exactly: ${expectedPlatforms.join(", ")}`);
}

const revisions = new Set();
for (const platform of expectedPlatforms) {
  const labels = images[platform]?.config?.Labels;
  if (labels?.["org.opencontainers.image.version"] !== expectedVersion) {
    throw new Error(`${platform} image version label must equal ${expectedVersion}`);
  }
  if (labels?.["org.opencontainers.image.source"] !== expectedSource) {
    throw new Error(`${platform} image source label must equal ${expectedSource}`);
  }
  const revision = labels?.["org.opencontainers.image.revision"];
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/u.test(revision)) {
    throw new Error(`${platform} image revision label must be a full lowercase commit`);
  }
  revisions.add(revision);
}
if (revisions.size !== 1) throw new Error("image revision labels differ by platform");
process.stdout.write(`${[...revisions][0]}\n`);
