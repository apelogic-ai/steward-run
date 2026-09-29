#!/usr/bin/env node
import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const forbiddenPatterns = [
  { name: "AWS ECR registry", pattern: /\b\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\b/giu },
  { name: "AWS IAM role", pattern: /\barn:aws(?:-[a-z]+)?:iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+\b/gu },
  { name: "private hostname", pattern: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:internal|local)(?=[:/\s]|$)/giu },
  { name: "private release variable", pattern: /\b(?:AWS_ROLE_ARN|AWS_RELEASE_ROLE_ARN|ECR_REGISTRY|ECR_REPOSITORY)\b/gu },
];

async function filesUnder(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) throw new Error(`Public release input must not be a symlink: ${path}`);
  if (metadata.isFile()) return [path];
  if (!metadata.isDirectory()) throw new Error(`Public release input is not a file or directory: ${path}`);
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    files.push(...(await filesUnder(join(path, entry.name))));
  }
  return files;
}

async function artifactText(path) {
  if (extname(path) !== ".tgz") return readFile(path, "utf8");
  const { stdout } = await execFileAsync("tar", ["-xOzf", path], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

export async function checkPublicReleaseAssets(paths) {
  if (!paths.length) throw new Error("usage: check-public-release-assets <file-or-directory>...");
  const files = (await Promise.all(paths.map(filesUnder))).flat();
  if (!files.length) throw new Error("Public release asset set is empty");
  for (const path of files) {
    const content = await artifactText(path);
    const forbidden = forbiddenPatterns.find(({ pattern }) => {
      pattern.lastIndex = 0;
      return pattern.test(content);
    });
    if (forbidden) {
      throw new Error(`${forbidden.name} found in public release asset ${path}`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  checkPublicReleaseAssets(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
