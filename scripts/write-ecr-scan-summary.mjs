import { readFile, writeFile } from "node:fs/promises";

const [scanPath, outputPath, repository, indexDigest, runnableDigest] = process.argv.slice(2);

if (!scanPath || !outputPath || !repository || !indexDigest || !runnableDigest) {
  throw new Error(
    "usage: write-ecr-scan-summary <scan-findings> <output> <repository> <index-digest> <runnable-digest>",
  );
}
if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(repository)) {
  throw new Error("ECR repository name is invalid");
}
for (const [name, digest] of [
  ["index", indexDigest],
  ["runnable", runnableDigest],
]) {
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new Error(`${name} image digest is invalid`);
  }
}

const scan = JSON.parse(await readFile(scanPath, "utf8"));
if (scan?.repositoryName !== repository) {
  throw new Error("ECR scan repository does not match the release repository");
}
if (scan?.imageId?.imageDigest !== runnableDigest) {
  throw new Error("ECR scan digest does not match the runnable image digest");
}
if (scan?.imageScanStatus?.status !== "COMPLETE") {
  throw new Error(`ECR scan is not complete: ${scan?.imageScanStatus?.status ?? "missing"}`);
}

const rawCounts = scan?.imageScanFindings?.findingSeverityCounts ?? {};
if (typeof rawCounts !== "object" || rawCounts === null || Array.isArray(rawCounts)) {
  throw new Error("ECR scan severity counts are invalid");
}
const findingSeverityCounts = Object.fromEntries(
  Object.entries(rawCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([severity, count]) => {
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error(`ECR scan count for ${severity} is invalid`);
      }
      return [severity, count];
    }),
);

const summary = {
  schemaVersion: 1,
  provider: "aws-ecr",
  repository,
  indexDigest,
  runnableImage: {
    operatingSystem: "linux",
    architecture: "amd64",
    digest: runnableDigest,
  },
  status: "COMPLETE",
  findingSeverityCounts,
  completedAt: scan?.imageScanFindings?.imageScanCompletedAt ?? null,
  vulnerabilitySourceUpdatedAt:
    scan?.imageScanFindings?.vulnerabilitySourceUpdatedAt ?? null,
};

await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
