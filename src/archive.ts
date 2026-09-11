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

export type ExecutionLogMode = "off" | "full";

export interface ExecutionTranscript {
  stdout: Buffer;
  stderr: Buffer;
}

const diagnosticsRoot = ".steward/diagnostics";
const stdoutTranscriptPath = `${diagnosticsRoot}/stdout.log`;
const stderrTranscriptPath = `${diagnosticsRoot}/stderr.log`;
const transcriptLimit = 4 * 1024 * 1024;

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

function canonicalInvocationPath(value: string): string {
  if (
    !value ||
    value.length > 512 ||
    value !== value.trim() ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    posix.isAbsolute(value) ||
    win32.isAbsolute(value) ||
    posix.normalize(value) !== value ||
    value.split("/").some((component) =>
      !component ||
      component === "." ||
      component === ".." ||
      !/^[A-Za-z0-9._-]+$/u.test(component)
    )
  ) {
    throw new Error("invocation-path must be a canonical repository-relative path");
  }
  return value;
}

export async function validateInvocationFile(workspace: string, value: string): Promise<string> {
  const relative = canonicalInvocationPath(value);
  let current = workspace;
  const components = relative.split("/");
  for (const [index, component] of components.entries()) {
    current = join(current, component);
    const metadata = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw new Error("invocation-path does not exist");
      throw error;
    });
    if (metadata.isSymbolicLink()) {
      throw new Error("invocation-path must not contain symbolic links");
    }
    const final = index === components.length - 1;
    if ((!final && !metadata.isDirectory()) || (final && !metadata.isFile())) {
      throw new Error("invocation-path must identify a regular file");
    }
  }
  return relative;
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

function isStrictAncestorOfDeclaredOutput(path: string, outputs: readonly string[]): boolean {
  return outputs.some((output) => output.startsWith(`${path}/`));
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

async function readTranscriptFile(stream: Readable, path: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > transcriptLimit) {
      throw new Error(`execution transcript exceeds ${transcriptLimit} bytes: ${path}`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}

function isDiagnosticsPath(path: string): boolean {
  return path === diagnosticsRoot || path.startsWith(`${diagnosticsRoot}/`);
}

function hasCanonicalReservedSpelling(
  archivePath: string,
  normalized: string,
  type: string | null | undefined,
): boolean {
  const withoutRoot = archivePath.startsWith("./") ? archivePath.slice(2) : archivePath;
  const candidate = type === "directory" && withoutRoot.endsWith("/")
    ? withoutRoot.slice(0, -1)
    : withoutRoot;
  return candidate === normalized;
}

export async function extractOutputArchive(
  archive: Readable,
  workspace: string,
  declaredPaths: readonly string[],
  diagnostics: { executionLog: ExecutionLogMode } = { executionLog: "off" },
): Promise<ExecutionTranscript | undefined> {
  const outputs = declaredPaths.map(normalizeWorkspacePath);
  const seen = new Set<string>();
  let sawRootDirectory = false;
  let stdout: Buffer | undefined;
  let stderr: Buffer | undefined;
  const extract = tar.extract();
  extract.on("entry", (header, stream, next) => {
    // The extractor destroys the active entry stream when `next(error)` fails the
    // archive. Keep that expected secondary error from becoming unhandled.
    stream.on("error", () => undefined);
    void (async () => {
      try {
        // GNU tar and compatible producers commonly emit this harmless root
        // directory header before the actual output entries. Accept only its
        // canonical spelling and only as a directory; all other empty/root-like
        // names still pass through the normal unsafe-path rejection below.
        if (header.name === "./" && header.type === "directory") {
          if (sawRootDirectory) throw new Error("duplicate archive entry: ./");
          sawRootDirectory = true;
          stream.resume();
          next();
          return;
        }
        const relative = normalizeArchivePath(header.name);
        if (
          isDiagnosticsPath(relative) ||
          (diagnostics.executionLog === "full" && relative === ".steward")
        ) {
          if (diagnostics.executionLog !== "full") {
            stream.resume();
            throw new Error("reserved diagnostics require full execution logging");
          }
          if (!hasCanonicalReservedSpelling(header.name, relative, header.type)) {
            stream.resume();
            throw new Error("reserved diagnostics archive path is not canonical");
          }
          if (seen.has(relative)) throw new Error(`duplicate archive entry: ${relative}`);
          seen.add(relative);
          if (relative === ".steward" || relative === diagnosticsRoot) {
            if (header.type !== "directory") {
              stream.resume();
              throw new Error(`reserved diagnostics ancestor must be a directory: ${relative}`);
            }
            stream.resume();
          } else if (relative === stdoutTranscriptPath || relative === stderrTranscriptPath) {
            if (header.type !== "file") {
              stream.resume();
              throw new Error(`reserved execution transcript must be a file: ${relative}`);
            }
            const body = await readTranscriptFile(stream, relative);
            if (relative === stdoutTranscriptPath) stdout = body;
            else stderr = body;
          } else {
            stream.resume();
            throw new Error(`unknown reserved diagnostics path: ${relative}`);
          }
          next();
          return;
        }
        const isDeclared = isDeclaredOutput(relative, outputs);
        const isAncestor = isStrictAncestorOfDeclaredOutput(relative, outputs);
        if (!isDeclared && !isAncestor) {
          throw new Error(`archive path is not a declared output: ${relative}`);
        }
        if (seen.has(relative)) throw new Error(`duplicate archive entry: ${relative}`);
        seen.add(relative);
        if (!isDeclared && header.type !== "directory") {
          stream.resume();
          throw new Error(`archive ancestor entry type is not allowed: ${header.type ?? "unknown"}`);
        }
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
  if (diagnostics.executionLog === "full") {
    if (stdout === undefined || stderr === undefined) {
      throw new Error("missing reserved execution transcript");
    }
    return { stdout, stderr };
  }
  return undefined;
}
