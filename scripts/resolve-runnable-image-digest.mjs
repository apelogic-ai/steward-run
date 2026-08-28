import { readFile } from "node:fs/promises";

const [manifestPath, operatingSystem, architecture] = process.argv.slice(2);

if (!manifestPath || !operatingSystem || !architecture) {
  throw new Error(
    "usage: resolve-runnable-image-digest <oci-index-manifest> <operating-system> <architecture>",
  );
}

const index = JSON.parse(await readFile(manifestPath, "utf8"));
const manifests = index?.manifests;
if (!Array.isArray(manifests)) {
  throw new Error("OCI index does not contain a manifests array");
}

const matches = manifests.filter(
  (manifest) =>
    manifest?.platform?.os === operatingSystem &&
    manifest?.platform?.architecture === architecture &&
    manifest?.annotations?.["vnd.docker.reference.type"] !== "attestation-manifest",
);

if (matches.length !== 1) {
  throw new Error(
    `OCI index must contain exactly one runnable ${operatingSystem}/${architecture} manifest; found ${matches.length}`,
  );
}

const digest = matches[0]?.digest;
if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
  throw new Error("runnable image manifest digest is invalid");
}

process.stdout.write(digest);
