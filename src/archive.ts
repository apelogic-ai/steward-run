import { createWriteStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, posix, win32 } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import tar from "tar-stream";

interface ArchiveEntry {
  name: string;
  source: string;
  type: "file" | "directory";
  mode: number;
}

function invalidWorkspacePath(value: string): Error {
  return new Error(`workspace-relative path is invalid: ${JSON.stringify(value)}`);
}

function normalizeWorkspacePath(value: string): string {
  let candidate = value.trim();
  while (candidate.startsWith("./")) candidate = candidate.slice(2);
  if (
    !candidate ||
    candidate === "." ||
    candidate.includes("\\") ||
    candidate.includes("\0") ||
    posix.isAbsolute(candidate) ||
    win32.isAbsolute(candidate)
  ) {
    throw invalidWorkspacePath(value);
  }
  const normalized = posix.normalize(candidate);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw invalidWorkspacePath(value);
  }
  return normalized;
}

export function parseWorkspacePaths(source: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const line of source.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const normalized = normalizeWorkspacePath(line);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      paths.push(normalized);
    }
  }
  if (paths.length === 0) throw invalidWorkspacePath(source);
  return paths;
}

async function collectEntries(
  workspace: string,
  relative: string,
  entries: Map<string, ArchiveEntry>,
): Promise<void> {
  const source = join(workspace, ...relative.split("/"));
  const metadata = await lstat(source).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new Error(`declared input does not exist: ${relative}`);
    }
    throw error;
  });
  if (metadata.isSymbolicLink()) {
    throw new Error(`symbolic links are not allowed in inputs: ${relative}`);
  }
  if (metadata.isDirectory()) {
    entries.set(relative, {
      name: relative,
      source,
      type: "directory",
      mode: metadata.mode & 0o777,
    });
    const children = await readdir(source);
    children.sort((left, right) => left.localeCompare(right, "en"));
    for (const child of children) {
      await collectEntries(workspace, posix.join(relative, child), entries);
    }
    return;
  }
  if (!metadata.isFile()) {
    throw new Error(`only regular files and directories are allowed in inputs: ${relative}`);
  }
  entries.set(relative, {
    name: relative,
    source,
    type: "file",
    mode: metadata.mode & 0o777,
  });
}

export async function createInputArchive(
  workspace: string,
  paths: readonly string[],
): Promise<Readable> {
  const entries = new Map<string, ArchiveEntry>();
  for (const path of paths) {
    await collectEntries(workspace, normalizeWorkspacePath(path), entries);
  }
  const ordered = [...entries.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  );
  const pack = tar.pack();
  void (async () => {
    try {
      for (const entry of ordered) {
        const header = {
          name: entry.name,
          type: entry.type,
          mode: entry.mode,
          mtime: new Date(0),
          uid: 0,
          gid: 0,
          uname: "",
          gname: "",
        } as const;
        if (entry.type === "directory") {
          await new Promise<void>((resolve, reject) => {
            pack.entry(header, (error) => (error ? reject(error) : resolve()));
          });
        } else {
          const body = await readFile(entry.source);
          await new Promise<void>((resolve, reject) => {
            pack.entry(header, body, (error) => (error ? reject(error) : resolve()));
          });
        }
      }
      pack.finalize();
    } catch (error) {
      pack.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  })();
  return pack;
}

function normalizeArchivePath(value: string): string {
  if (
    !value ||
    value.includes("\\") ||
    value.includes("\0") ||
    posix.isAbsolute(value) ||
    win32.isAbsolute(value)
  ) {
    throw new Error(`unsafe archive path: ${JSON.stringify(value)}`);
  }
  const normalized = posix.normalize(value.replace(/\/$/u, ""));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`unsafe archive path: ${JSON.stringify(value)}`);
  }
  return normalized;
}

function isDeclaredOutput(path: string, outputs: readonly string[]): boolean {
  return outputs.some((root) => path === root || path.startsWith(`${root}/`));
}

async function ensureSafeDirectories(workspace: string, relativeDirectory: string): Promise<void> {
  if (!relativeDirectory || relativeDirectory === ".") return;
  let current = workspace;
  for (const component of relativeDirectory.split("/")) {
    current = join(current, component);
    const metadata = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (metadata?.isSymbolicLink()) {
      throw new Error(`symbolic link in output path: ${relativeDirectory}`);
    }
    if (metadata && !metadata.isDirectory()) {
      throw new Error(`non-directory in output path: ${relativeDirectory}`);
    }
    if (!metadata) await mkdir(current);
  }
}

async function writeOutputFile(
  stream: Readable,
  workspace: string,
  relative: string,
  mode: number | undefined,
): Promise<void> {
  const parent = dirname(relative).split("\\").join("/");
  await ensureSafeDirectories(workspace, parent);
  const target = join(workspace, ...relative.split("/"));
  const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing?.isSymbolicLink()) throw new Error(`symbolic link in output path: ${relative}`);
  if (existing?.isDirectory()) throw new Error(`output file would replace a directory: ${relative}`);
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  try {
    await pipeline(stream, createWriteStream(temporary, { flags: "wx", mode: mode ?? 0o600 }));
    await chmod(temporary, (mode ?? 0o600) & 0o777);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function extractOutputArchive(
  archive: Readable,
  workspace: string,
  declaredPaths: readonly string[],
): Promise<void> {
  const outputs = declaredPaths.map(normalizeWorkspacePath);
  const seen = new Set<string>();
  const extract = tar.extract();
  extract.on("entry", (header, stream, next) => {
    // The extractor destroys the active entry stream when `next(error)` fails the
    // archive. Keep that expected secondary error from becoming unhandled.
    stream.on("error", () => undefined);
    void (async () => {
      try {
        const relative = normalizeArchivePath(header.name);
        if (!isDeclaredOutput(relative, outputs)) {
          throw new Error(`archive path is not a declared output: ${relative}`);
        }
        if (seen.has(relative)) throw new Error(`duplicate archive entry: ${relative}`);
        seen.add(relative);
        if (header.type === "directory") {
          stream.resume();
          await ensureSafeDirectories(workspace, relative);
        } else if (header.type === "file") {
          await writeOutputFile(stream, workspace, relative, header.mode);
        } else {
          stream.resume();
          throw new Error(`archive entry type is not allowed: ${header.type ?? "unknown"}`);
        }
        next();
      } catch (error) {
        stream.resume();
        next(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
  await pipeline(archive, extract);
}
