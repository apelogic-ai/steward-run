import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import tar from "tar-stream";
import {
  createInputArchive,
  extractOutputArchive,
  parseWorkspacePaths,
} from "../src/archive.ts";

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function archive(entries: Array<{ name: string; type?: "file" | "directory" | "link" | "symlink"; body?: string }>): Promise<Readable> {
  const pack = tar.pack();
  for (const entry of entries) {
    pack.entry(
      {
        name: entry.name,
        type: entry.type ?? "file",
        linkname: entry.type === "symlink" || entry.type === "link" ? "../../escape" : undefined,
      },
      entry.body ?? "",
    );
  }
  pack.finalize();
  return Readable.from(await collect(pack));
}

test("workspace paths are normalized, deduplicated, and confined", () => {
  assert.deepEqual(parseWorkspacePaths(" ./in/a \n in/a\nresults/out "), ["in/a", "results/out"]);
  for (const invalid of ["/etc/passwd", "../escape", "a/../../escape", "C:\\escape", "a\\b", "."] ) {
    assert.throws(() => parseWorkspacePaths(invalid), /workspace-relative path/);
  }
});

test("input archives are deterministic and reject symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-archive-"));
  try {
    await mkdir(join(root, "in"));
    await writeFile(join(root, "in", "b.txt"), "b");
    await writeFile(join(root, "in", "a.txt"), "a");
    const first = await collect(await createInputArchive(root, ["in"]));
    const second = await collect(await createInputArchive(root, ["in"]));
    assert.deepEqual(first, second);

    await symlink("a.txt", join(root, "in", "link"));
    await assert.rejects(createInputArchive(root, ["in"]), /symbolic links are not allowed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("declared outputs round-trip without writing elsewhere", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-output-"));
  try {
    const input = await archive([
      { name: "results", type: "directory" },
      { name: "results/report.txt", body: "governed" },
    ]);
    await extractOutputArchive(input, root, ["results"]);
    assert.equal(await readFile(join(root, "results", "report.txt"), "utf8"), "governed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("output extraction accepts only the canonical tar root directory entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-root-entry-"));
  try {
    const input = await archive([
      { name: "./", type: "directory" },
      { name: "./out", type: "directory" },
      { name: "./out/payload.bin", body: "governed" },
    ]);
    await extractOutputArchive(input, root, ["out"]);
    assert.equal(await readFile(join(root, "out", "payload.bin"), "utf8"), "governed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("output extraction accepts strict ancestor directories for an exact file declaration", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-output-ancestor-"));
  try {
    const input = await archive([
      { name: "./", type: "directory" },
      { name: "./out/", type: "directory" },
      { name: "./out/payload.bin", body: "governed" },
    ]);
    await extractOutputArchive(input, root, ["out/payload.bin"]);
    assert.equal(await readFile(join(root, "out", "payload.bin"), "utf8"), "governed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("output extraction rejects traversal, undeclared paths, links, and symlink parents", async () => {
  const cases = [
    { entry: { name: "./", body: "bad" }, outputs: ["results"], error: /unsafe archive path/ },
    { entry: { name: ".", type: "directory" as const }, outputs: ["results"], error: /unsafe archive path/ },
    { entry: { name: "../escape", body: "bad" }, outputs: ["results"], error: /unsafe archive path/ },
    { entry: { name: "/absolute", body: "bad" }, outputs: ["results"], error: /unsafe archive path/ },
    { entry: { name: "other/file", body: "bad" }, outputs: ["results"], error: /not a declared output/ },
    { entry: { name: "out/sibling.bin", body: "bad" }, outputs: ["out/payload.bin"], error: /not a declared output/ },
    { entry: { name: "results/link", type: "symlink" as const }, outputs: ["results"], error: /archive entry type/ },
  ];
  for (const current of cases) {
    const root = await mkdtemp(join(tmpdir(), "steward-run-reject-"));
    try {
      await assert.rejects(
        extractOutputArchive(await archive([current.entry]), root, current.outputs),
        current.error,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  for (const type of ["file", "symlink", "link"] as const) {
    const root = await mkdtemp(join(tmpdir(), "steward-run-ancestor-type-"));
    try {
      await assert.rejects(
        extractOutputArchive(
          await archive([{ name: "out", type, ...(type === "file" ? { body: "bad" } : {}) }]),
          root,
          ["out/payload.bin"],
        ),
        /archive ancestor entry type is not allowed/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  const duplicateRoot = await mkdtemp(join(tmpdir(), "steward-run-duplicate-root-"));
  try {
    await assert.rejects(
      extractOutputArchive(
        await archive([
          { name: "./", type: "directory" },
          { name: "./", type: "directory" },
        ]),
        duplicateRoot,
        ["results"],
      ),
      /duplicate archive entry/,
    );
  } finally {
    await rm(duplicateRoot, { recursive: true, force: true });
  }

  const duplicateAncestor = await mkdtemp(join(tmpdir(), "steward-run-duplicate-ancestor-"));
  try {
    await assert.rejects(
      extractOutputArchive(
        await archive([
          { name: "out", type: "directory" },
          { name: "./out/", type: "directory" },
        ]),
        duplicateAncestor,
        ["out/payload.bin"],
      ),
      /duplicate archive entry: out/,
    );
  } finally {
    await rm(duplicateAncestor, { recursive: true, force: true });
  }

  const root = await mkdtemp(join(tmpdir(), "steward-run-parent-"));
  const outside = await mkdtemp(join(tmpdir(), "steward-run-outside-"));
  try {
    await symlink(outside, join(root, "results"));
    await assert.rejects(
      extractOutputArchive(
        await archive([{ name: "results/report.txt", body: "bad" }]),
        root,
        ["results"],
      ),
      /symbolic link in output path/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("full diagnostics extracts bounded reserved transcripts without writing them to the workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-diagnostics-"));
  try {
    const extract = extractOutputArchive as unknown as (
      input: Readable,
      workspace: string,
      outputs: readonly string[],
      diagnostics: { executionLog: "full" },
    ) => Promise<{ stdout: Buffer; stderr: Buffer }>;
    const transcript = await extract(
      await archive([
        { name: "results/report.txt", body: "governed" },
        { name: ".steward", type: "directory" },
        { name: ".steward/diagnostics", type: "directory" },
        { name: ".steward/diagnostics/stdout.log", body: "agent stdout\n" },
        { name: ".steward/diagnostics/stderr.log", body: "agent stderr\n" },
      ]),
      root,
      ["results"],
      { executionLog: "full" },
    );

    assert.deepEqual(transcript, {
      stdout: Buffer.from("agent stdout\n"),
      stderr: Buffer.from("agent stderr\n"),
    });
    assert.equal(await readFile(join(root, "results", "report.txt"), "utf8"), "governed");
    await assert.rejects(lstat(join(root, ".steward")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reserved transcripts require full diagnostics and both exact bounded files", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-diagnostics-reject-"));
  const extract = extractOutputArchive as unknown as (
    input: Readable,
    workspace: string,
    outputs: readonly string[],
    diagnostics: { executionLog: "off" | "full" },
  ) => Promise<unknown>;
  try {
    await assert.rejects(
      extract(
        await archive([{ name: ".steward/diagnostics/stdout.log", body: "unexpected" }]),
        root,
        ["results"],
        { executionLog: "off" },
      ),
      /reserved diagnostics require full execution logging/,
    );
    await assert.rejects(
      extract(
        await archive([{ name: ".steward/diagnostics/stdout.log", body: "incomplete" }]),
        root,
        ["results"],
        { executionLog: "full" },
      ),
      /missing reserved execution transcript/,
    );
    await assert.rejects(
      extract(
        await archive([
          {
            name: ".steward/diagnostics/stdout.log",
            body: "x".repeat(4 * 1024 * 1024 + 1),
          },
          { name: ".steward/diagnostics/stderr.log", body: "" },
        ]),
        root,
        ["results"],
        { executionLog: "full" },
      ),
      /execution transcript exceeds 4194304 bytes/,
    );
    await assert.rejects(
      extract(
        await archive([
          { name: ".steward/diagnostics/stdout.log/", body: "aliased" },
          { name: ".steward/diagnostics/stderr.log", body: "" },
        ]),
        root,
        ["results"],
        { executionLog: "full" },
      ),
      /reserved diagnostics archive path is not canonical/,
    );
    await assert.rejects(
      extract(
        await archive([
          { name: ".steward/diagnostics/stdout.log", body: "" },
          { name: ".steward/diagnostics/stderr.log", body: "" },
          { name: ".steward/diagnostics/extra.log", body: "unexpected" },
        ]),
        root,
        ["results"],
        { executionLog: "full" },
      ),
      /unknown reserved diagnostics path/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
