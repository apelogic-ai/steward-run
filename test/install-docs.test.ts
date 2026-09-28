import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { parse } from "yaml";

test("the v0.7.2 guide is one self-contained operator runbook", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const guide = await readFile(new URL("../docs/installation.md", import.meta.url), "utf8");
  const historical = await readFile(new URL("../docs/installation-v0.5.0.md", import.meta.url), "utf8");
  const arcReadme = await readFile(new URL("../charts/steward-run-arc/README.md", import.meta.url), "utf8");

  assert.match(readme, /v0\.7\.2 installation, setup, and integration guide/u);
  assert.match(arcReadme, /v0\.7\.2/u);
  assert.match(historical, /Historical release guide/u);
  for (const section of [
    "Prerequisites",
    "Installation",
    "Authentication discovery contract",
    "Integration and object inventory",
    "Deprecated compatibility inputs",
    "Post-install",
    "Delivery tests",
    "Upgrade",
    "Rollback",
  ]) {
    assert.match(guide, new RegExp(`## ${section}`, "u"));
  }

  for (const marker of [
    "GitHub.com Actions",
    "GitHub App",
    "github_app_id",
    "github_app_installation_id",
    "github_app_private_key",
    "Kubernetes 1.32 through 1.36",
    "Helm 3.17+",
    "Cosign 3.1+",
    "0.14.2",
    "sha256sum -c SHA256SUMS",
    "cosign verify-blob",
    "cosign verify --experimental-oci11=true",
    "workflowCommit",
    "actionCommit",
    "linux/amd64",
    "linux/arm64",
    "steward-run-arc-preflight.mjs",
    "helm lint",
    "helm template",
    "upgrade --install",
    "uninstall steward-run",
  ]) {
    assert.ok(guide.includes(marker), marker);
  }
  assert.match(guide, /schema 3/u);
  assert.match(guide, /manifest remains schema 3[\s\S]*?`image`[\s\S]*?ARC runner and governed job-container/u);
  assert.match(guide, /governedJobContainerImage/u);
  assert.match(guide, /does not create or alter GitHub App credentials/u);
  assert.doesNotMatch(guide, /kubectl[^\n]*create secret|--from-file=github_app/iu);
  assert.match(guide, /Uninstalling steward-run does not remove[\s\S]*?shared ARC controller/u);

  const values = guide.match(/cat > customer-values\.yaml <<YAML\n([\s\S]*?)\nYAML/u)?.[1];
  assert.ok(values, "complete customer-values heredoc");
  const parsed = parse(values) as Record<string, any>;
  const scaleSet = parsed["gha-runner-scale-set"];
  const runner = scaleSet?.template?.spec?.containers?.[0];
  assert.equal(scaleSet?.githubConfigSecret, "$GITHUB_APP_SECRET");
  assert.equal(scaleSet?.controllerServiceAccount?.name, "arc-gha-rs-controller");
  assert.deepEqual(runner?.command, ["/home/runner/run.sh"]);
  assert.equal(runner?.securityContext?.allowPrivilegeEscalation, false);
  assert.deepEqual(runner?.securityContext?.capabilities?.drop, ["ALL"]);
  assert.ok(runner?.resources?.requests?.cpu);
  assert.ok(runner?.resources?.requests?.memory);
  assert.ok(runner?.resources?.limits?.cpu);
  assert.ok(runner?.resources?.limits?.memory);
});

test("the public upstream and private-fork integration boundaries are explicit", async () => {
  const [guide, readme, workflowSource] = await Promise.all([
    readFile(new URL("../docs/installation.md", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/steward-task-customer.yml", import.meta.url), "utf8"),
  ]);
  const workflow = parse(workflowSource) as {
    on: { workflow_call: { inputs: Record<string, unknown> } };
    jobs: { governed: { steps: Array<Record<string, any>> } };
  };

  for (const document of [guide, readme]) {
    assert.match(document, /public upstream workflow directly|Direct consumption of the public upstream reusable workflow is supported/u);
    assert.match(document, /different private fork|different repository cannot assume/u);
    assert.match(document, /no PAT|accepts no\s+PAT/u);
    assert.match(document, /job_workflow_ref/u);
  }
  assert.match(guide, /job_workflow_ref=apelogic-ai\/steward-run\/\.github\/workflows\/steward-task-customer\.yml@REVIEWED_40_HEX_COMMIT/u);
  assert.match(guide, /Exact matching is byte-for-byte/u);
  assert.match(guide, /Do not authorize a branch, tag, repository-wide\s+wildcard/u);
  for (const forbidden of ["token", "pat", "checkout-token", "action-ref", "container-image"]) {
    assert.equal(workflow.on.workflow_call.inputs[forbidden], undefined, forbidden);
  }
  const sourceCheckout = workflow.jobs.governed.steps.find((step) => step.id === "workflow-source");
  assert.equal(sourceCheckout?.with?.repository, "${{ job.workflow_repository }}");
  assert.equal(sourceCheckout?.with?.ref, "${{ job.workflow_sha }}");
  assert.equal(sourceCheckout?.with?.["persist-credentials"], false);
});

test("current authentication, timeout, links, and examples cannot drift", async () => {
  const root = new URL("..", import.meta.url).pathname;
  const [guide, readme, specification, actionSource, arcReadme, libraryReadme, releaseNotes] = await Promise.all([
    readFile(new URL("../docs/installation.md", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/steward-run-spec.md", import.meta.url), "utf8"),
    readFile(new URL("../action.yml", import.meta.url), "utf8"),
    readFile(new URL("../charts/steward-run-arc/README.md", import.meta.url), "utf8"),
    readFile(new URL("../charts/steward-run/README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/release-notes-v0.7.2.md", import.meta.url), "utf8"),
  ]);
  const action = parse(actionSource) as { inputs: Record<string, { required?: boolean; default?: string }> };
  const compatibility = [
    "identity-exchange-url",
    "identity-exchange-audience",
    "steward-ca-certificate-file",
  ];
  for (const name of compatibility) {
    assert.notEqual(action.inputs[name]?.required, true, name);
    assert.equal(action.inputs[name]?.default, "", name);
    for (const document of [guide, readme, specification]) assert.ok(document.includes(name), name);
  }
  assert.equal(action.inputs["runtime-binding-timeout-minutes"]?.default, "10");

  for (const file of ["steward-task.yml", "steward-task-self-hosted.yml", "steward-task-customer.yml"]) {
    const source = await readFile(resolve(root, ".github", "workflows", file), "utf8");
    const workflow = parse(source) as {
      on: { workflow_call: { inputs: Record<string, { required?: boolean; default?: string | number; description?: string; type?: string }> } };
      jobs: { governed: { "timeout-minutes": string; steps: Array<Record<string, any>> } };
    };
    for (const name of compatibility) {
      assert.notEqual(workflow.on.workflow_call.inputs[name]?.required, true, `${file}:${name}`);
      assert.equal(workflow.on.workflow_call.inputs[name]?.default, "", `${file}:${name}`);
    }
    assert.equal(workflow.on.workflow_call.inputs["job-timeout-minutes"]?.default, 15);
    assert.match(workflow.on.workflow_call.inputs["job-timeout-minutes"]?.description ?? "", /whole minutes \(1-360\)/u);
    assert.equal(workflow.on.workflow_call.inputs["runtime-binding-timeout-minutes"]?.default, 10);
    assert.equal(workflow.jobs.governed["timeout-minutes"], "${{ inputs.job-timeout-minutes }}");
    assert.ok(workflow.jobs.governed.steps.some((step) => step.name === "Validate job timeout"));
    const task = workflow.jobs.governed.steps.find((step) => step.id === "task");
    assert.equal(task?.with?.["runtime-binding-timeout-minutes"], "${{ inputs.runtime-binding-timeout-minutes }}");
  }

  assert.match(guide, /audience without an explicit URL is rejected/u);
  assert.match(guide, /Non-empty bypasses discovery/u);
  assert.match(guide, /system trust/u);
  assert.match(guide, /64 KiB/u);
  assert.match(guide, /five-second timeout/u);
  assert.match(guide, /ten-second\s+budget/u);
  assert.match(guide, /Metadata responses must be exactly HTTP 200/u);
  assert.match(guide, /job-timeout-minutes[\s\S]*?whole minutes from 1[\s\S]*?through 360/u);
  assert.match(guide, /within that window/u);
  assert.match(guide, /GET https:\/\/steward\.customer\.example\/\.well-known\/oauth-protected-resource/u);
  assert.match(guide, /"resource": "https:\/\/steward\.customer\.example"/u);
  assert.match(guide, /"issuer": "https:\/\/identity\.customer\.example"/u);
  assert.match(guide, /Discovery compares raw strings[\s\S]*?taskIdentity\.resource[\s\S]*?Identity's `issuer` exactly/u);
  assert.doesNotMatch(guide, /https:\/\/steward\.customer\.example\/api\b/u);
  assert.doesNotMatch(guide, /"https:\/\/identity\.customer\.example\/"/u);

  const documents = [
    [new URL("../README.md", import.meta.url), readme],
    [new URL("../docs/installation.md", import.meta.url), guide],
    [new URL("../docs/steward-run-spec.md", import.meta.url), specification],
    [new URL("../docs/release-notes-v0.7.2.md", import.meta.url), releaseNotes],
    [new URL("../charts/steward-run-arc/README.md", import.meta.url), arcReadme],
    [new URL("../charts/steward-run/README.md", import.meta.url), libraryReadme],
  ] as const;
  for (const [documentUrl, source] of documents) {
    for (const match of source.matchAll(/```yaml\n([\s\S]*?)```/gu)) parse(match[1] ?? "");
    for (const match of source.matchAll(/```json\n([\s\S]*?)```/gu)) JSON.parse(match[1] ?? "");
    for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      const target = match[1] ?? "";
      if (/^(?:https?:|mailto:|#)/u.test(target)) continue;
      const localUrl = new URL(target, documentUrl);
      localUrl.hash = "";
      await access(localUrl);
    }
  }
});
