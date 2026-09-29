#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

export const vendoredActionPlaceholder =
  "STEWARD_RUN_OWNER/STEWARD_RUN_REPOSITORY@STEWARD_RUN_ACTION_COMMIT";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(repository, ".github/workflows/steward-task-self-hosted.yml");
const vendoredPath = resolve(repository, "vendor/steward-task-vendored.yml");
const header =
  "# Generated from .github/workflows/steward-task-self-hosted.yml.\n" +
  "# Render this template with scripts/render-vendored-workflow.mjs and a verified release manifest.\n";

function expectedVendoredWorkflow(source) {
  const pinComments = new Map(
    [...source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)\s+(#\s*v[^\s]+)\s*$/gmu)].map(
      ([, reference, comment]) => [reference, comment],
    ),
  );
  const workflow = parse(source);
  const steps = workflow?.jobs?.governed?.steps;
  if (!Array.isArray(steps)) throw new Error("self-hosted workflow has no governed steps");
  const reservation = steps.filter(
    (step) => step?.name === "Reserve the trusted action checkout path",
  );
  const checkout = steps.filter((step) => step?.id === "workflow-source");
  const tasks = steps.filter((step) => step?.id === "task");
  if (reservation.length !== 1 || checkout.length !== 1 || tasks.length !== 1) {
    throw new Error("self-hosted workflow checkout boundary changed");
  }
  workflow.jobs.governed.steps = steps.filter(
    (step) =>
      step?.name !== "Reserve the trusted action checkout path" &&
      step?.id !== "workflow-source",
  );
  tasks[0].uses = vendoredActionPlaceholder;
  let rendered = `${header}${stringify(workflow, { lineWidth: 0 })}`;
  for (const [reference, comment] of pinComments) {
    rendered = rendered.replaceAll(`uses: ${reference}\n`, `uses: ${reference} ${comment}\n`);
  }
  return rendered;
}

const expected = expectedVendoredWorkflow(await readFile(sourcePath, "utf8"));
if (process.argv[2] === "--write") {
  await writeFile(vendoredPath, expected, "utf8");
  process.stdout.write(`updated ${vendoredPath}\n`);
} else {
  const actual = await readFile(vendoredPath, "utf8");
  if (actual !== expected) {
    throw new Error(
      "vendored self-hosted workflow drifted; run node scripts/check-vendored-workflow.mjs --write",
    );
  }
  process.stdout.write("vendored self-hosted workflow is structurally equivalent\n");
}
