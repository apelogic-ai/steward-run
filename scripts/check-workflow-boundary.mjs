#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const forbiddenPatterns = [
  { name: "private AWS/ECR expression", pattern: /\b(?:vars|secrets)\.(?:AWS|ECR)_[A-Z0-9_]*\b/iu },
  { name: "AWS action", pattern: /\baws-actions\//iu },
  { name: "Amazon ECR login action", pattern: /\bamazon-ecr-login\b/iu },
  { name: "AWS ECR CLI", pattern: /\baws\s+ecr\b/iu },
];

export async function checkWorkflowBoundary(workflowsDirectory) {
  const entries = await readdir(workflowsDirectory, { withFileTypes: true });
  const workflows = entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/iu.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (!workflows.length) throw new Error("workflow boundary check found no YAML workflows");

  const violations = [];
  for (const workflow of workflows) {
    const source = await readFile(resolve(workflowsDirectory, workflow), "utf8");
    for (const { name, pattern } of forbiddenPatterns) {
      if (pattern.test(source)) violations.push(`${workflow}: ${name}`);
    }
  }
  if (violations.length) {
    throw new Error(`public workflow boundary violations:\n${violations.join("\n")}`);
  }
  return workflows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workflowsDirectory = resolve(process.argv[2] ?? resolve(repository, ".github", "workflows"));
  checkWorkflowBoundary(workflowsDirectory)
    .then((workflows) => {
      process.stdout.write(`workflow boundary check passed: ${workflows.length} workflows\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
