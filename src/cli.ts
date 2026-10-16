import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

export interface CallerOptions {
  idempotencyKey?: string;
  outputsFile?: string;
  workspace?: string;
}

function nonEmptyOption(
  name: string,
  value: string | undefined,
  trim = true,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = trim ? value.trim() : value;
  if (!normalized) throw new Error(`--${name} must not be empty`);
  return normalized;
}

export function parseCallerOptions(args: readonly string[]): CallerOptions {
  const { values } = parseArgs({
    args: [...args],
    allowPositionals: false,
    options: {
      "idempotency-key": { type: "string" },
      "outputs-file": { type: "string" },
      workspace: { type: "string" },
    } as const,
    strict: true,
  });
  const idempotencyKey = nonEmptyOption("idempotency-key", values["idempotency-key"], false);
  const outputsFile = nonEmptyOption("outputs-file", values["outputs-file"]);
  const workspace = nonEmptyOption("workspace", values.workspace);
  return {
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(outputsFile === undefined ? {} : { outputsFile }),
    ...(workspace === undefined ? {} : { workspace }),
  };
}

export async function validateWorkspaceOption(value: string): Promise<string> {
  const workspace = resolve(value);
  const metadata = await lstat(workspace).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new Error("--workspace must identify an existing directory");
    throw error;
  });
  if (metadata.isSymbolicLink()) throw new Error("--workspace must not be a symbolic link");
  if (!metadata.isDirectory()) throw new Error("--workspace must identify an existing directory");
  return workspace;
}

export async function validateOutputsFileOption(
  workspace: string,
  value: string,
): Promise<string> {
  const target = resolve(workspace, value);
  const workspaceRelative = relative(workspace, target);
  if (
    !workspaceRelative ||
    isAbsolute(workspaceRelative) ||
    workspaceRelative === ".." ||
    workspaceRelative.startsWith(`..${sep}`)
  ) {
    throw new Error("--outputs-file must identify a file inside the workspace");
  }

  const components = workspaceRelative.split(sep);
  let current = workspace;
  for (const [index, component] of components.entries()) {
    current = resolve(current, component);
    const final = index === components.length - 1;
    const metadata = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" && final) return undefined;
      if (error.code === "ENOENT") {
        throw new Error("--outputs-file parent directory does not exist");
      }
      throw error;
    });
    if (metadata === undefined) return target;
    if (metadata.isSymbolicLink()) {
      throw new Error("--outputs-file must not contain symbolic links");
    }
    if ((!final && !metadata.isDirectory()) || (final && !metadata.isFile())) {
      throw new Error("--outputs-file must identify a regular file");
    }
  }
  return target;
}
