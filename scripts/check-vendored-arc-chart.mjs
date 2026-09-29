#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse } from "yaml";

const execFileAsync = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chartRoot = join(repository, "charts", "steward-run-arc");
const lock = JSON.parse(await readFile(join(chartRoot, "third-party-lock.json"), "utf8"));

if (lock?.schemaVersion !== 1 || !Array.isArray(lock.dependencies) || lock.dependencies.length !== 1) {
  throw new Error("third-party-lock.json must contain exactly one schema-1 dependency");
}

const [dependency] = lock.dependencies;
if (
  dependency?.name !== "gha-runner-scale-set" ||
  !/^\d+\.\d+\.\d+$/u.test(dependency.version) ||
  dependency.source !==
    "oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set" ||
  !/^sha256:[a-f0-9]{64}$/u.test(dependency.ociManifestDigest) ||
  dependency.archive !== `charts/gha-runner-scale-set-${dependency.version}.tgz` ||
  !/^[a-f0-9]{64}$/u.test(dependency.archiveSha256)
) {
  throw new Error("vendored ARC dependency lock is malformed");
}

const archivePath = join(chartRoot, dependency.archive);
const archive = await readFile(archivePath);
const archiveSha256 = createHash("sha256").update(archive).digest("hex");
if (archiveSha256 !== dependency.archiveSha256) {
  throw new Error(`vendored ARC archive checksum mismatch: ${archiveSha256}`);
}

const chart = parse(await readFile(join(chartRoot, "Chart.yaml"), "utf8"));
const helmLock = parse(await readFile(join(chartRoot, "Chart.lock"), "utf8"));
for (const document of [chart, helmLock]) {
  const declared = document?.dependencies?.find((entry) => entry?.name === dependency.name);
  if (
    declared?.version !== dependency.version ||
    `${declared?.repository}/${dependency.name}` !== dependency.source
  ) {
    throw new Error("Chart dependency metadata does not match the vendored ARC lock");
  }
}

const chartEntries = (await readdir(join(chartRoot, "charts"))).sort();
if (chartEntries.length !== 1 || chartEntries[0] !== dependency.archive.split("/").at(-1)) {
  throw new Error(`unexpected files in vendored chart directory: ${chartEntries.join(", ")}`);
}

const { stdout: vendoredChartSource } = await execFileAsync(
  "tar",
  ["-xOf", archivePath, `${dependency.name}/Chart.yaml`],
  { encoding: "utf8", maxBuffer: 1024 * 1024 },
);
const vendoredChart = parse(vendoredChartSource);
if (vendoredChart?.name !== dependency.name || vendoredChart?.version !== dependency.version) {
  throw new Error("vendored ARC archive metadata does not match its lock");
}

process.stdout.write(
  `vendored ARC chart verified: ${dependency.name} ${dependency.version} ${dependency.archiveSha256}\n`,
);
