import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const [combinedPath, amd64Path, amd64Digest, arm64Path, arm64Digest] = process.argv.slice(2);
const digestPattern = /^sha256:[a-f0-9]{64}$/u;

if (!combinedPath || !amd64Path || !amd64Digest || !arm64Path || !arm64Digest) {
  throw new Error(
    "usage: verify-combined-image-index <combined-index> <amd64-index> <amd64-digest> <arm64-index> <arm64-digest>",
  );
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

function digest(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function parseIndex(content, label) {
  let index;
  try {
    index = JSON.parse(content);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!Array.isArray(index?.manifests) || index.manifests.length === 0) {
    throw new Error(`${label} does not contain manifests`);
  }
  return index;
}

function normalizedDescriptors(manifests) {
  return manifests
    .map((descriptor) => JSON.stringify(canonical(descriptor)))
    .sort();
}

const combinedContent = await readFile(combinedPath);
const amd64Content = await readFile(amd64Path);
const arm64Content = await readFile(arm64Path);
if (!digestPattern.test(amd64Digest) || digest(amd64Content) !== amd64Digest) {
  throw new Error("amd64 source index does not match AMD64_DIGEST");
}
if (!digestPattern.test(arm64Digest) || digest(arm64Content) !== arm64Digest) {
  throw new Error("arm64 source index does not match ARM64_DIGEST");
}

const combined = parseIndex(combinedContent, "combined index");
const amd64 = parseIndex(amd64Content, "amd64 source index");
const arm64 = parseIndex(arm64Content, "arm64 source index");
const actual = normalizedDescriptors(combined.manifests);
const expected = normalizedDescriptors([...amd64.manifests, ...arm64.manifests]);
if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
  throw new Error(
    "combined index manifests are not exactly the manifests from AMD64_DIGEST and ARM64_DIGEST",
  );
}

process.stdout.write(`${digest(combinedContent)}\n`);
