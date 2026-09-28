import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

test("the composite action exposes the versioned steward-run contract", async () => {
  const source = await readFile(new URL("../action.yml", import.meta.url), "utf8");
  const action = parse(source) as {
    inputs: Record<string, { required?: boolean; default?: string; description?: string }>;
    outputs: Record<string, unknown>;
    runs: { using: string; steps: Array<{ shell?: string; run?: string; uses?: string; with?: Record<string, unknown>; id?: string; if?: string }> };
  };

  assert.equal(action.runs.using, "composite");
  assert.deepEqual(
    Object.keys(action.inputs).sort(),
    [
      "agent-runtime",
      "bearer-token-file",
      "envelope-digest",
      "identity-exchange-url",
      "identity-exchange-audience",
      "invocation-path",
      "inputs",
      "oidc-audience",
      "outputs",
      "runtime-binding-timeout-minutes",
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
  assert.notEqual(action.inputs["envelope-digest"]?.required, true);
  assert.equal(action.inputs["runtime-binding-timeout-minutes"]?.default, "10");
  assert.match(source, /STEWARD_RUN_RUNTIME_BINDING_TIMEOUT_MINUTES:\s*\$\{\{ inputs\.runtime-binding-timeout-minutes \}\}/u);
  for (const name of [
    "identity-exchange-url",
    "identity-exchange-audience",
    "steward-ca-certificate-file",
  ]) {
    assert.equal(action.inputs[name]?.default, "", `${name} must default to empty`);
    assert.match(action.inputs[name]?.description ?? "", /Deprecated compatibility/u);
  }
  assert.equal(action.inputs["coding-agent-runtime"], undefined);
  assert.deepEqual(
    Object.keys(action.outputs).sort(),
    ["failure-category", "http-status", "outcome", "runtime-uid", "status", "task-uid"],
  );
  const nodeProbe = action.runs.steps.find((step) => step.id === "node24");
  assert.match(nodeProbe?.run ?? "", /command -v node/u);
  assert.match(nodeProbe?.run ?? "", /\^v24\\\./u);
  assert.match(nodeProbe?.run ?? "", /available=true/u);
  assert.match(nodeProbe?.run ?? "", /available=false/u);
  const setupNode = action.runs.steps.find((step) => step.uses?.startsWith("actions/setup-node@"));
  assert.equal(setupNode?.if, "steps.node24.outputs.available != 'true'");
  assert.equal(setupNode?.uses, "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
  assert.equal(setupNode?.with?.["node-version"], "24.21.0");
  assert.equal(setupNode?.with?.["package-manager-cache"], false);
  assert.match(action.runs.steps.find((step) => step.id === "steward-run")?.run ?? "", /dist\/index\.cjs/);
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
          oneOf: Array<{ $ref: string }>;
        };
        WorkflowTaskSubmissionRequest: {
          required: string[];
          properties: Record<string, unknown>;
          additionalProperties: boolean;
        };
        DirectTaskSubmissionRequest: {
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
  assert.deepEqual(api.components.schemas.TaskSubmissionRequest.oneOf, [
    { $ref: "#/components/schemas/WorkflowTaskSubmissionRequest" },
    { $ref: "#/components/schemas/DirectTaskSubmissionRequest" },
  ]);
  assert.deepEqual(api.components.schemas.WorkflowTaskSubmissionRequest.required, ["workflow"]);
  assert.deepEqual(Object.keys(api.components.schemas.WorkflowTaskSubmissionRequest.properties), [
    "workflow",
    "envelopeDigest",
    "agentRuntimeUid",
  ]);
  assert.equal(api.components.schemas.WorkflowTaskSubmissionRequest.additionalProperties, false);
  assert.deepEqual(api.components.schemas.DirectTaskSubmissionRequest.required, [
    "contractVersion",
    "invocationPath",
  ]);
  assert.deepEqual(Object.keys(api.components.schemas.DirectTaskSubmissionRequest.properties), [
    "contractVersion",
    "invocationPath",
    "envelopeDigest",
  ]);
  assert.equal(api.components.schemas.DirectTaskSubmissionRequest.additionalProperties, false);
  assert.deepEqual(api.components.schemas.TaskStatusResponse.properties.runtimeUid.oneOf, [
    { type: "string", minLength: 1 },
    { type: "null" },
  ]);
});
