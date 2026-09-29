import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

test("the customer workflow executes only its own immutable action with GitHub OIDC", async () => {
  const source = await readFile(new URL("../.github/workflows/steward-task-customer.yml", import.meta.url), "utf8");
  const existingSource = await readFile(new URL("../.github/workflows/steward-task-self-hosted.yml", import.meta.url), "utf8");
  const workflow = parse(source) as {
    on: { workflow_call: { inputs: Record<string, { required?: boolean; default?: string | number; type?: string }>; outputs: Record<string, unknown> } };
    jobs: Record<string, { container?: unknown; permissions?: Record<string, string>; "runs-on"?: string; "timeout-minutes"?: string; steps?: Array<Record<string, unknown>> }>;
  };
  const existing = parse(existingSource) as typeof workflow;
  const job = workflow.jobs.governed;
  assert.equal(job?.container, undefined);
  assert.equal(job?.permissions?.contents, "read");
  assert.equal(job?.permissions?.["id-token"], "write");
  assert.equal(job?.["runs-on"], "${{ inputs.runner-label }}");
  assert.equal(job?.["timeout-minutes"], "${{ inputs.job-timeout-minutes }}");
  assert.deepEqual(
    Object.keys(workflow.on.workflow_call.outputs).sort(),
    ["failure-category", "http-status", "outcome", "runtime-uid", "status", "task-uid"],
  );
  assert.deepEqual(
    Object.keys(existing.on.workflow_call.outputs).sort(),
    ["failure-category", "http-status", "outcome", "runtime-uid", "status", "task-uid"],
  );
  assert.deepEqual(Object.keys(workflow.on.workflow_call.inputs).sort(), Object.keys(existing.on.workflow_call.inputs).sort());
  for (const required of ["runner-label", "input-artifact", "output-artifact", "steward-api-url"]) {
    assert.equal(workflow.on.workflow_call.inputs[required]?.required, true, required);
  }
  for (const optional of ["identity-exchange-url", "identity-exchange-audience", "steward-ca-certificate-file"]) {
    assert.notEqual(workflow.on.workflow_call.inputs[optional]?.required, true, optional);
    assert.equal((workflow.on.workflow_call.inputs[optional] as { default?: string })?.default, "", optional);
  }
  assert.equal(workflow.on.workflow_call.inputs["job-timeout-minutes"]?.type, "number");
  assert.equal(workflow.on.workflow_call.inputs["job-timeout-minutes"]?.default, 15);
  assert.equal(workflow.on.workflow_call.inputs["runtime-binding-timeout-minutes"]?.type, "number");
  assert.equal(workflow.on.workflow_call.inputs["runtime-binding-timeout-minutes"]?.default, 10);
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
    "envelope-digest": "${{ inputs.envelope-digest }}",
    "invocation-path": "${{ inputs.invocation-path }}",
    inputs: "in",
    outputs: "out",
    "steward-api-url": "${{ inputs.steward-api-url }}",
    "identity-exchange-url": "${{ inputs.identity-exchange-url }}",
    "identity-exchange-audience": "${{ inputs.identity-exchange-audience }}",
    "steward-ca-certificate-file": "${{ inputs.steward-ca-certificate-file }}",
    "agent-runtime": "${{ inputs.agent-runtime }}",
    "runtime-binding-timeout-minutes": "${{ inputs.runtime-binding-timeout-minutes }}",
  });
  assert.match(source, /actions\/download-artifact@/);
  assert.match(source, /actions\/upload-artifact@/);
  assert.doesNotMatch(source, /uses:\s*apelogic-ai\/steward-run@|amazonaws\.com|container:|bearer-token|identity\.dev/iu);
  assert.ok(steps.indexOf(callerCheckout ?? {}) < steps.indexOf(selfCheckout ?? {}));
  assert.ok(steps.indexOf(callerCheckout ?? {}) < steps.indexOf(reservation ?? {}));
  assert.ok(steps.indexOf(reservation ?? {}) < steps.indexOf(selfCheckout ?? {}));
  assert.ok(steps.indexOf(selfCheckout ?? {}) < steps.indexOf(task ?? {}));
});

test("the current handoff documents the public workflow and published OSS artifacts", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const guide = await readFile(new URL("../docs/installation.md", import.meta.url), "utf8");
  const rebuild = await readFile(new URL("../docs/customer-rebuild.md", import.meta.url), "utf8");
  for (const document of [readme, guide]) {
    assert.match(document, /steward-task-customer\.yml/u);
    assert.doesNotMatch(document, /customer reusable workflow is pending|customer workflow artifact is not approved|fork-self-pinned OIDC workflow and live governed-job evidence are still open/u);
  }
  assert.match(rebuild, /# Fork, rebuild, and publish/u);
  assert.match(rebuild, /STEWARD_RUN_RELEASE_AMD64_RUNNER/u);
  assert.match(rebuild, /STEWARD_RUN_RELEASE_ARM64_RUNNER/u);
  assert.match(rebuild, /third-party-lock\.json/u);
  assert.match(rebuild, /must not run `helm dependency build`/u);
  assert.match(rebuild, /GHCR package visibility is independent/u);
  assert.match(rebuild, /workflowCommit` and `actionCommit`/u);
  assert.match(rebuild, /jobs\.governed\.container\.image/u);
  assert.match(rebuild, /job-container-X\.Y\.Z/u);
  assert.match(rebuild, /Before every release,[\s\S]*?silently trail the[\s\S]*?release/u);
  assert.match(rebuild, /portable release[\s\S]*?workflow's `bootstrap`[\s\S]*?operation/u);
  assert.match(rebuild, /snapshot\.ubuntu\.com/u);
  assert.match(rebuild, /manifest records it in[\s\S]*?existing `image` field/u);
  assert.match(rebuild, /retire-bootstrap/u);
  assert.match(rebuild, /steward-task-vendored\.yml/u);
  assert.match(rebuild, /Steward issue[\s\S]*?#218/u);
  assert.match(rebuild, /the task wrote nothing to out\//u);
  assert.match(rebuild, /Settings → Actions → General → Access/u);
  assert.match(rebuild, /artifacthub-repo\.yml` `repositoryID`/u);
  assert.match(rebuild, /supported publication target is the fork owner's GHCR namespace/u);
  assert.match(guide, /job\.workflow_repository/u);
  assert.match(guide, /job\.workflow_sha/u);
  assert.match(guide, /GitHub Enterprise Server is not covered/u);
  assert.match(guide, /oauth-protected-resource/u);
  assert.match(guide, /Direct consumption of the public upstream reusable workflow is supported/u);
  assert.match(guide, /Private fork consumed by another repository/u);
  assert.match(guide, /steward-task-vendored\.yml/u);
  assert.match(guide, /github\.com\/apelogic-ai\/steward\/issues\/218/u);
  assert.match(guide, /the task wrote nothing to out\//u);
  assert.match(guide, /no workflow-ref or workflow-SHA selector/u);
  assert.match(guide, /numeric GitHub owner and repository IDs/u);
  assert.doesNotMatch(guide, /job_workflow_ref=apelogic-ai\/steward-run/u);
  assert.doesNotMatch(rebuild, /unsupported legacy|does not define or support/u);
});
