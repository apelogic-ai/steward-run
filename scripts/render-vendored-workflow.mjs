#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const placeholder = "STEWARD_RUN_OWNER/STEWARD_RUN_REPOSITORY@STEWARD_RUN_ACTION_COMMIT";
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  return "usage: render-vendored-workflow <verified-manifest.json> <output.yml> [template.yml]";
}

const [manifestArgument, outputArgument, templateArgument] = process.argv.slice(2);
if (!manifestArgument || !outputArgument) throw new Error(usage());

const manifestPath = resolve(manifestArgument);
const outputPath = resolve(outputArgument);
const templatePath = resolve(
  templateArgument ?? resolve(repository, "vendor/steward-task-self-hosted.yml"),
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
  throw new Error("release manifest must be a JSON object");
}
if (manifest.schemaVersion !== 3) throw new Error("release manifest schemaVersion must equal 3");
if (
  typeof manifest.workflowRepository !== "string" ||
  !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(manifest.workflowRepository)
) {
  throw new Error("release manifest workflowRepository must be owner/repository");
}
if (
  typeof manifest.actionCommit !== "string" ||
  !/^[0-9a-f]{40}$/u.test(manifest.actionCommit)
) {
  throw new Error("release manifest actionCommit must be a full lowercase commit");
}

const template = await readFile(templatePath, "utf8");
if (template.split(placeholder).length !== 2) {
  throw new Error("vendored workflow template must contain exactly one action placeholder");
}
const rendered = template.replace(
  placeholder,
  `${manifest.workflowRepository}@${manifest.actionCommit}`,
);
if (rendered.includes("STEWARD_RUN_ACTION_COMMIT")) {
  throw new Error("vendored workflow rendering left an action placeholder");
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, rendered, "utf8");
process.stdout.write(
  `rendered ${manifest.workflowRepository}@${manifest.actionCommit} to ${outputPath}\n`,
);
