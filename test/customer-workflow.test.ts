import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

test("the customer workflow executes only its own immutable action with GitHub OIDC", async () => {
  const source = await readFile(new URL("../.github/workflows/steward-task-customer.yml", import.meta.url), "utf8");
  const existingSource = await readFile(new URL("../.github/workflows/steward-task-self-hosted.yml", import.meta.url), "utf8");
  const workflow = parse(source) as {
    on: { workflow_call: { inputs: Record<string, { required?: boolean }>; outputs: Record<string, unknown> } };
    jobs: Record<string, { container?: unknown; permissions?: Record<string, string>; "runs-on"?: string; steps?: Array<Record<string, unknown>> }>;
  };
  const existing = parse(existingSource) as typeof workflow;
  const job = workflow.jobs.governed;
  assert.equal(job?.container, undefined);
  assert.equal(job?.permissions?.contents, "read");
  assert.equal(job?.permissions?.["id-token"], "write");
  assert.equal(job?.["runs-on"], "${{ inputs.runner-label }}");
  assert.deepEqual(Object.keys(workflow.on.workflow_call.outputs).sort(), ["runtime-uid", "status", "task-uid"]);
  assert.deepEqual(Object.keys(workflow.on.workflow_call.inputs).sort(), Object.keys(existing.on.workflow_call.inputs).sort());
  for (const required of ["runner-label", "input-artifact", "output-artifact", "steward-api-url", "identity-exchange-url", "identity-exchange-audience"]) {
    assert.equal(workflow.on.workflow_call.inputs[required]?.required, true, required);
  }
  for (const forbidden of ["action-repository", "action-ref", "action-commit", "container-image", "job-container-image"]) {
    assert.equal(workflow.on.workflow_call.inputs[forbidden], undefined, forbidden);
  }
  const steps = job?.steps ?? [];
  const callerCheckout = steps.find((step) => step.id === "caller-source");
  const selfCheckout = steps.find((step) => step.id === "workflow-source");
  const task = steps.find((step) => step.id === "task");
  assert.equal(callerCheckout?.uses, "actions/checkout@11d5960a326750d5838078e36cf38b85af677262");
  assert.equal(callerCheckout?.if, "inputs.invocation-path != ''");
  assert.deepEqual(callerCheckout?.with, { ref: "${{ github.sha }}", "persist-credentials": false });
  assert.equal(selfCheckout?.uses, "actions/checkout@11d5960a326750d5838078e36cf38b85af677262");
  assert.deepEqual(selfCheckout?.with, {
    repository: "${{ job.workflow_repository }}",
    ref: "${{ job.workflow_sha }}",
    path: ".steward-run-action",
    "persist-credentials": false,
  });
  const reservation = steps.find((step) => typeof step.run === "string" && step.run.includes("test ! -L .steward-run-action") && step.run.includes("test ! -e .steward-run-action"));
  assert.ok(reservation);
  assert.equal(task?.uses, "./.steward-run-action");
  assert.deepEqual(task?.with, {
    workflow: "${{ inputs.workflow }}",
    "invocation-path": "${{ inputs.invocation-path }}",
    inputs: "in",
    outputs: "out",
    "steward-api-url": "${{ inputs.steward-api-url }}",
    "identity-exchange-url": "${{ inputs.identity-exchange-url }}",
    "identity-exchange-audience": "${{ inputs.identity-exchange-audience }}",
    "steward-ca-certificate-file": "${{ inputs.steward-ca-certificate-file }}",
    "agent-runtime": "${{ inputs.agent-runtime }}",
  });
  assert.match(source, /actions\/download-artifact@/);
  assert.match(source, /actions\/upload-artifact@/);
  assert.doesNotMatch(source, /uses:\s*apelogic-ai\/steward-run@|amazonaws\.com|container:|bearer-token|identity\.dev/iu);
  assert.ok(steps.indexOf(callerCheckout ?? {}) < steps.indexOf(selfCheckout ?? {}));
  assert.ok(steps.indexOf(callerCheckout ?? {}) < steps.indexOf(reservation ?? {}));
  assert.ok(steps.indexOf(reservation ?? {}) < steps.indexOf(selfCheckout ?? {}));
  assert.ok(steps.indexOf(selfCheckout ?? {}) < steps.indexOf(task ?? {}));
});

test("the current handoff documents the fork workflow and published OSS artifacts", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const guide = await readFile(new URL("../docs/installation-v0.4.2.md", import.meta.url), "utf8");
  const rebuild = await readFile(new URL("../docs/customer-rebuild.md", import.meta.url), "utf8");
  for (const document of [readme, guide]) {
    assert.match(document, /steward-task-customer\.yml/u);
    assert.doesNotMatch(document, /customer reusable workflow is pending|customer workflow artifact is not approved|fork-self-pinned OIDC workflow and live governed-job evidence are still open/u);
  }
  assert.match(rebuild, /Track B in the versioned installation guide/u);
  assert.match(guide, /job\.workflow_repository/u);
  assert.match(guide, /job\.workflow_sha/u);
  assert.match(guide, /GitHub Enterprise Server is not covered/u);
  assert.match(guide, /ghcr\.io\/apelogic-ai\/steward-run:0\.4\.2/u);
});
