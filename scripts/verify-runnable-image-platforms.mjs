import { readFile } from "node:fs/promises";

const [manifestPath, ...expectedPlatforms] = process.argv.slice(2);

if (!manifestPath || expectedPlatforms.length === 0) {
  throw new Error(
    "usage: verify-runnable-image-platforms <oci-index-manifest> <os/architecture>...",
  );
}

const expected = [...new Set(expectedPlatforms)].sort();
if (
  expected.length !== expectedPlatforms.length ||
  expected.some((platform) => !/^[a-z0-9]+\/[a-z0-9]+$/u.test(platform))
) {
  throw new Error("expected runnable platforms are invalid or duplicated");
}

const index = JSON.parse(await readFile(manifestPath, "utf8"));
if (!Array.isArray(index?.manifests)) {
  throw new Error("OCI index does not contain a manifests array");
}

const runnable = index.manifests
  .filter(
    (manifest) =>
      manifest?.annotations?.["vnd.docker.reference.type"] !== "attestation-manifest",
  )
  .map((manifest) => {
    const operatingSystem = manifest?.platform?.os;
    const architecture = manifest?.platform?.architecture;
    const digest = manifest?.digest;
    if (
      typeof operatingSystem !== "string" ||
      typeof architecture !== "string" ||
      typeof digest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(digest)
    ) {
      throw new Error("runnable image manifest is malformed");
    }
    return `${operatingSystem}/${architecture}`;
  })
  .sort();

if (
  runnable.length !== expected.length ||
  runnable.some((platform, index) => platform !== expected[index])
) {
  throw new Error(
    `OCI index runnable platforms must be exactly: ${expected.join(", ")}; found: ${runnable.join(", ") || "none"}`,
  );
}

process.stdout.write(`${runnable.join("\n")}\n`);
