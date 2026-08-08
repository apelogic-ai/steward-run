import { readFile, writeFile } from "node:fs/promises";

const [
  metadataPath,
  outputPath,
  version,
  actionCommit,
  imageRepository,
  governedJobContainerImage,
] = process.argv.slice(2);

if (
  !metadataPath ||
  !outputPath ||
  !version ||
  !actionCommit ||
  !imageRepository ||
  !governedJobContainerImage
) {
  throw new Error(
    "usage: write-release-manifest <build-metadata> <output> <version> <commit> <image-repository> <governed-job-container-image>",
  );
}
if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error("release version is invalid");
if (!/^[a-f0-9]{40}$/u.test(actionCommit)) throw new Error("release action commit is invalid");
if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]+$/u.test(imageRepository) || imageRepository.includes("@")) {
  throw new Error("release image repository is invalid");
}
const governedJobContainerMatch =
  /^([A-Za-z0-9][A-Za-z0-9._:/-]+)@(sha256:[a-f0-9]{64})$/u.exec(
    governedJobContainerImage,
  );
const governedJobContainerRepository = governedJobContainerMatch?.[1];
const governedJobContainerDigest = governedJobContainerMatch?.[2];
if (
  !governedJobContainerRepository ||
  !governedJobContainerDigest ||
  governedJobContainerRepository.split("/").at(-1)?.includes(":")
) {
  throw new Error("governed job-container image is invalid");
}

const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
const digest = metadata?.["containerimage.digest"];
if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
  throw new Error("build metadata does not contain a valid OCI image digest");
}

const manifest = {
  schemaVersion: 3,
  version,
  action: { commit: actionCommit },
  reusableWorkflow: {
    repository: "apelogic-ai/steward-run",
    path: ".github/workflows/steward-task.yml",
    commit: actionCommit,
    immutableReference:
      `apelogic-ai/steward-run/.github/workflows/steward-task.yml@${actionCommit}`,
  },
  runnerImage: {
    role: "arc-runner",
    repository: imageRepository,
    digest,
    immutableReference: `${imageRepository}@${digest}`,
  },
  governedJobContainerImage: {
    repository: governedJobContainerRepository,
    digest: governedJobContainerDigest,
    immutableReference: governedJobContainerImage,
  },
};

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
