import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("chart notes require exact ARC identity preflight", async () => {
  const notes = await readFile(
    new URL("../charts/steward-run-arc/templates/NOTES.txt", import.meta.url),
    "utf8",
  );
  assert.match(notes, /<controller Helm release>-gha-rs-controller/u);
  assert.match(notes, /kubectl get serviceaccount/u);
  assert.match(notes, /steward-run-arc-preflight\.mjs/u);
  assert.match(notes, /--runner-namespace/u);
});
