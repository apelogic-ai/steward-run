import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { parse } from "yaml";

test("the v0.8.1 guide is one self-contained operator runbook", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const guide = await readFile(new URL("../docs/installation.md", import.meta.url), "utf8");
  const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const historical = await readFile(new URL("../docs/installation-v0.5.0.md", import.meta.url), "utf8");
  const arcReadme = await readFile(new URL("../charts/steward-run-arc/README.md", import.meta.url), "utf8");
  const applicationChart = parse(
    await readFile(new URL("../charts/steward-run-arc/Chart.yaml", import.meta.url), "utf8"),
  ) as { kubeVersion?: string };
  const libraryChart = parse(
    await readFile(new URL("../charts/steward-run/Chart.yaml", import.meta.url), "utf8"),
  ) as { kubeVersion?: string };

  assert.match(readme, /v0\.8\.1 installation, setup, and integration guide/u);
  assert.match(arcReadme, /v0\.8\.1/u);
  assert.match(changelog, /## \[0\.8\.1\][\s\S]*?v0\.8\.0 tag is an incomplete publication and must not be used/u);
  assert.match(changelog, /## \[0\.8\.0\][\s\S]*?Do not use v0\.8\.0; use\s+v0\.8\.1/u);
  assert.match(historical, /Historical release guide/u);
  assert.equal(applicationChart.kubeVersion, ">=1.32.0-0 <1.37.0-0");
  assert.equal(libraryChart.kubeVersion, applicationChart.kubeVersion);
  for (const section of [
    "Prerequisites",
    "Installation",
    "Authentication discovery contract",
    "Integration and object inventory",
    "Explicit exchange compatibility inputs",
    "Network egress and proxies",
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
  assert.match(guide, /manifest remains schema 3[\s\S]*?`image`[\s\S]*?governed job-container/u);
  assert.match(guide, /governedJobContainerImage/u);
  assert.doesNotMatch(guide, /workflowJobContainerImage/u);
  assert.match(guide, /refs\/heads\/main/u);
  assert.match(
    guide,
    /RELEASE_IDENTITY="https:\/\/github\.com\/\$RELEASE_REPOSITORY\/\.github\/workflows\/portable-release\.yml@refs\/tags\/\$RELEASE_TAG"/u,
  );
  assert.match(guide, /embedded BuildKit SLSA provenance/u);
  assert.match(guide, /not GitHub artifact attestations/u);
  assert.match(guide, /Pod Security Admission/u);
  assert.match(guide, /pod-security\.kubernetes\.io\/enforce=restricted/u);
  assert.match(guide, /runner Pod spec is a closed\s+allowlist/u);
  assert.match(guide, /does not create or alter GitHub App credentials/u);
  assert.match(guide, /PAT\s+registration[\s\S]*?unsupported/u);
  assert.match(guide, /github\.com\/enterprises/u);
  assert.match(guide, /minRunners: 0[\s\S]*?containerMode\.type: `?""`?[\s\S]*?named `runner`/u);
  assert.match(guide, /HTTP_PROXY[\s\S]*?HTTPS_PROXY[\s\S]*?NO_PROXY/u);
  assert.match(guide, /ACTIONS_ID_TOKEN_REQUEST_URL/u);
  assert.match(guide, /results-receiver\.actions\.githubusercontent\.com/u);
  assert.match(guide, /private-CA[\s\S]*?same proxy path/u);
  assert.match(guide, /Lowercase variables win over uppercase/u);
  assert.match(guide, /Steward and[\s\S]*?Identity hosts to `NO_PROXY`/u);
  assert.match(guide, /private-CA path, including redirected requests/u);
  assert.doesNotMatch(guide, /kubectl[^\n]*create secret|--from-file=github_app/iu);
  assert.match(guide, /Uninstalling steward-run does not remove[\s\S]*?shared ARC controller/u);

  const values = guide.match(/cat > customer-values\.yaml <<YAML\n([\s\S]*?)\nYAML/u)?.[1];
  assert.ok(values, "complete customer-values heredoc");
  const parsed = parse(values) as Record<string, any>;
  const scaleSet = parsed["gha-runner-scale-set"];
  const pod = scaleSet?.template?.spec;
  const runner = pod?.containers?.[0];
  assert.equal(scaleSet?.githubConfigSecret, "$GITHUB_APP_SECRET");
  assert.equal(scaleSet?.controllerServiceAccount?.name, "arc-gha-rs-controller");
  assert.equal(pod?.automountServiceAccountToken, false);
  assert.equal(pod?.securityContext?.fsGroup, 1001);
  assert.equal(pod?.securityContext?.fsGroupChangePolicy, "OnRootMismatch");
  assert.deepEqual(pod?.securityContext?.seccompProfile, { type: "RuntimeDefault" });
  assert.deepEqual(runner?.command, ["/home/runner/run.sh"]);
  assert.equal(runner?.securityContext?.allowPrivilegeEscalation, false);
  assert.equal(runner?.securityContext?.runAsNonRoot, true);
  assert.equal(runner?.securityContext?.runAsUser, 1001);
  assert.equal(runner?.securityContext?.runAsGroup, 1001);
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
    assert.match(document, /private fork|private-fork/u);
    assert.match(document, /no PAT|accepts no\s+PAT|No PAT/u);
    assert.match(document, /job_workflow_ref/u);
  }
  assert.match(guide, /Private fork consumed by another repository/u);
  assert.match(guide, /steward-task-vendored\.template\.yml/u);
  assert.match(guide, /uses: \.\/\.github\/workflows\/steward-task-vendored\.yml/u);
  assert.match(guide, /Steward issue[\s\S]*?#218/u);
  assert.match(guide, /no workflow-ref or workflow-SHA selector/u);
  assert.match(guide, /numeric GitHub owner and repository IDs/u);
  assert.match(guide, /github-oidc-exchange\/issues\/82/u);
  assert.doesNotMatch(guide, /job_workflow_ref=apelogic-ai\/steward-run/u);
  for (const forbidden of ["token", "pat", "checkout-token", "action-ref", "container-image"]) {
    assert.equal(workflow.on.workflow_call.inputs[forbidden], undefined, forbidden);
  }
  const sourceCheckout = workflow.jobs.governed.steps.find((step) => step.id === "workflow-source");
  assert.equal(sourceCheckout?.with?.repository, "${{ job.workflow_repository }}");
  assert.equal(sourceCheckout?.with?.ref, "${{ job.workflow_sha }}");
  assert.equal(sourceCheckout?.with?.["persist-credentials"], false);
});

test("current authentication, task sources, timeout, links, and examples cannot drift", async () => {
  const root = new URL("..", import.meta.url).pathname;
  const [guide, readme, specification, actionSource, arcReadme, libraryReadme, releaseNotes, incompleteReleaseNotes, previousReleaseNotes, securityReleaseNotes, priorReleaseNotes] = await Promise.all([
    readFile(new URL("../docs/installation.md", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/steward-run-spec.md", import.meta.url), "utf8"),
    readFile(new URL("../action.yml", import.meta.url), "utf8"),
    readFile(new URL("../charts/steward-run-arc/README.md", import.meta.url), "utf8"),
    readFile(new URL("../charts/steward-run/README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/release-notes-v0.8.1.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/release-notes-v0.8.0.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/release-notes-v0.7.6.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/release-notes-v0.7.5.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/release-notes-v0.7.4.md", import.meta.url), "utf8"),
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
  assert.equal(action.inputs["execution-log"]?.default, "off");

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
    assert.equal(workflow.on.workflow_call.inputs["execution-log"]?.default, "off");
    assert.equal(workflow.jobs.governed["timeout-minutes"], "${{ inputs.job-timeout-minutes }}");
    assert.ok(workflow.jobs.governed.steps.some((step) => step.name === "Validate job timeout"));
    const task = workflow.jobs.governed.steps.find((step) => step.id === "task");
    assert.equal(task?.with?.["runtime-binding-timeout-minutes"], "${{ inputs.runtime-binding-timeout-minutes }}");
    assert.equal(task?.with?.["package-path"], "${{ inputs.package-path }}");
    assert.equal(task?.with?.["execution-log"], "${{ inputs.execution-log }}");
  }

  assert.match(guide, /rejected without that URL/u);
  assert.match(guide, /not required yet/u);
  assert.match(guide, /apelogic-github-identity-exchange/u);
  assert.match(guide, /Non-empty bypasses discovery/u);
  assert.match(guide, /system trust/u);
  assert.match(guide, /64 KiB/u);
  assert.match(guide, /five-second timeout/u);
  assert.match(guide, /ten-second\s+budget/u);
  assert.match(guide, /Metadata responses must be exactly HTTP 200/u);
  assert.match(guide, /steward_package_path_supported/u);
  assert.match(guide, /Steward 0\.3\.10 or later/u);
  assert.match(guide, /job-timeout-minutes[\s\S]*?whole minutes from 1[\s\S]*?through 360/u);
  assert.match(guide, /within that window/u);
  assert.match(guide, /GET https:\/\/steward\.customer\.example\/\.well-known\/oauth-protected-resource/u);
  assert.match(guide, /"resource": "https:\/\/steward\.customer\.example"/u);
  assert.match(guide, /"issuer": "https:\/\/identity\.customer\.example"/u);
  assert.match(guide, /Discovery compares raw strings[\s\S]*?taskIdentity\.resource[\s\S]*?Identity's `issuer` exactly/u);
  assert.match(priorReleaseNotes, /proxy variables are newly honored/u);
  assert.match(priorReleaseNotes, /private-CA request path now follows redirects/u);
  assert.match(releaseNotes, /package-path/u);
  assert.match(releaseNotes, /packagePathInvocation/u);
  assert.match(releaseNotes, /v0\.8\.0 is incomplete and must not be used/u);
  assert.match(incompleteReleaseNotes, /Incomplete publication — do not use/u);
  assert.match(previousReleaseNotes, /failure-category=authentication/u);
  assert.match(previousReleaseNotes, /steward-task-vendored\.yml/u);
  assert.match(securityReleaseNotes, /CVE-2026-75803/u);
  assert.match(securityReleaseNotes, /v0\.7\.4 remains affected/u);
  assert.doesNotMatch(guide, /https:\/\/steward\.customer\.example\/api\b/u);
  assert.doesNotMatch(guide, /"https:\/\/identity\.customer\.example\/"/u);

  const documents = [
    [new URL("../README.md", import.meta.url), readme],
    [new URL("../docs/installation.md", import.meta.url), guide],
    [new URL("../docs/steward-run-spec.md", import.meta.url), specification],
    [new URL("../docs/release-notes-v0.8.1.md", import.meta.url), releaseNotes],
    [new URL("../docs/release-notes-v0.8.0.md", import.meta.url), incompleteReleaseNotes],
    [new URL("../docs/release-notes-v0.7.6.md", import.meta.url), previousReleaseNotes],
    [new URL("../docs/release-notes-v0.7.5.md", import.meta.url), securityReleaseNotes],
    [new URL("../docs/release-notes-v0.7.4.md", import.meta.url), priorReleaseNotes],
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
