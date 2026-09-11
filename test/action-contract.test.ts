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
      "bearer-token-file",
    "identity-exchange-url",
      "identity-exchange-audience",
      "invocation-path",
      "inputs",
      "oidc-audience",
      "outputs",
      "steward-ca-certificate-file",
      "steward-api-url",
      "workflow",
    ].sort(),
  );
  for (const name of ["inputs", "outputs", "steward-api-url"]) {
    assert.equal(action.inputs[name]?.required, true, `${name} must be required`);
  }
  assert.notEqual(action.inputs.workflow?.required, true);
  assert.notEqual(action.inputs["invocation-path"]?.required, true);
  assert.notEqual(action.inputs["oidc-audience"]?.required, true);
  assert.notEqual(action.inputs["identity-exchange-url"]?.required, true);
  assert.notEqual(action.inputs["bearer-token-file"]?.required, true);
  assert.notEqual(action.inputs["steward-ca-certificate-file"]?.required, true);
  assert.equal(action.inputs["coding-agent-runtime"], undefined);
  assert.deepEqual(Object.keys(action.outputs).sort(), ["runtime-uid", "status", "task-uid"]);
  assert.match(action.runs.steps[0]?.run ?? "", /dist\/index\.cjs/);
});

test("the Steward Task API contract covers the complete lifecycle", async () => {
  const source = await readFile(
    new URL("../contracts/steward-run-v1.openapi.yaml", import.meta.url),
    "utf8",
  );
  const api = parse(source) as {
    openapi: string;
    paths: Record<string, Record<string, unknown>>;
    components: {
      schemas: {
        TaskSubmissionRequest: {
          required: string[];
          properties: Record<string, unknown>;
          additionalProperties: boolean;
        };
        TaskStatusResponse: {
          properties: { runtimeUid: { oneOf: Array<{ type: string; minLength?: number }> } };
        };
      };
    };
  };

  assert.match(api.openapi, /^3\.1\./);
  assert.ok(api.paths["/v1/tasks"]?.post);
  assert.ok(api.paths["/v1/tasks/{taskUid}/inputs"]?.put);
  assert.ok(api.paths["/v1/tasks/{taskUid}/execute"]?.post);
  assert.ok(api.paths["/v1/tasks/{taskUid}"]?.get);
  assert.ok(api.paths["/v1/tasks/{taskUid}/outputs"]?.get);
  assert.ok(api.paths["/v1/tasks/{taskUid}"]?.delete);
  assert.doesNotMatch(source, /\/v1\/runs|runUid/u);
  assert.match(source, /steward-task-api/);
  assert.match(source, /67108864/);
  assert.match(source, /Task accepted for controller-owned runtime binding/u);
  assert.deepEqual(api.components.schemas.TaskSubmissionRequest.required, ["workflow"]);
  assert.deepEqual(Object.keys(api.components.schemas.TaskSubmissionRequest.properties), [
    "workflow",
    "agentRuntimeUid",
  ]);
  assert.equal(api.components.schemas.TaskSubmissionRequest.additionalProperties, false);
  assert.deepEqual(api.components.schemas.TaskStatusResponse.properties.runtimeUid.oneOf, [
    { type: "string", minLength: 1 },
    { type: "null" },
  ]);
});
