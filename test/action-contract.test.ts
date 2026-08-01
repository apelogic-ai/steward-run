import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

test("the composite action exposes the versioned steward-run contract", async () => {
  const source = await readFile(new URL("../action.yml", import.meta.url), "utf8");
  const action = parse(source) as {
    inputs: Record<string, { required?: boolean; default?: string }>;
    outputs: Record<string, unknown>;
    runs: { using: string; steps: Array<{ shell?: string; run?: string }> };
  };

  assert.equal(action.runs.using, "composite");
  assert.deepEqual(
    Object.keys(action.inputs).sort(),
    [
      "agent-runtime",
      "coding-agent-runtime",
      "inputs",
      "oidc-audience",
      "outputs",
      "steward-api-url",
      "workflow",
    ].sort(),
  );
  for (const name of [
    "workflow",
    "inputs",
    "outputs",
    "steward-api-url",
    "oidc-audience",
  ]) {
    assert.equal(action.inputs[name]?.required, true, `${name} must be required`);
  }
  assert.equal(action.inputs["coding-agent-runtime"]?.default, "claude-code@2.1.220");
  assert.deepEqual(Object.keys(action.outputs).sort(), ["runtime-uid", "status"]);
  assert.match(action.runs.steps[0]?.run ?? "", /dist\/index\.mjs/);
});

test("the provisional Steward API covers the complete run lifecycle", async () => {
  const source = await readFile(
    new URL("../contracts/steward-run-v1.openapi.yaml", import.meta.url),
    "utf8",
  );
  const api = parse(source) as {
    openapi: string;
    paths: Record<string, Record<string, unknown>>;
  };

  assert.match(api.openapi, /^3\.1\./);
  assert.ok(api.paths["/v1/runs"]?.post);
  assert.ok(api.paths["/v1/runs/{runUid}/inputs"]?.put);
  assert.ok(api.paths["/v1/runs/{runUid}/execute"]?.post);
  assert.ok(api.paths["/v1/runs/{runUid}"]?.get);
  assert.ok(api.paths["/v1/runs/{runUid}/outputs"]?.get);
  assert.ok(api.paths["/v1/runs/{runUid}"]?.delete);
});
