import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { parse } from "yaml";

test("README leads to the v0.6.0 guide while v0.5.0 evidence stays historical", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const current = await readFile(new URL("../docs/installation.md", import.meta.url), "utf8");
  const guide = await readFile(new URL("../docs/installation-v0.5.0.md", import.meta.url), "utf8");
  const rebuild = await readFile(new URL("../docs/customer-rebuild.md", import.meta.url), "utf8");
  const arcReadme = await readFile(new URL("../charts/steward-run-arc/README.md", import.meta.url), "utf8");
  assert.match(readme, /docs\/installation\.md/u);
  assert.match(readme, /ARC controller[\s\S]*?external/u);
  assert.match(readme, /steward-run-arc/u);
  assert.doesNotMatch(readme, /this private source repository|There is currently no public steward-run runner image or OCI chart/u);
  for (const section of ["Prerequisites", "Installation", "Post-install", "Upgrade", "Rollback", "Delivery tests", "Integration and object inventory"]) {
    assert.match(guide, new RegExp(`## ${section}`, "u"));
  }
  for (const marker of [
    "github_app_id", "github_app_installation_id", "github_app_private_key",
    "--from-file", "id-token: write", "steward-run-github-app", "imagePullSecrets",
    "ca.crt", "0.14.2", "2.336.0", "GitHub.com", "ghcr.io/apelogic-ai/steward-run",
    "linux/amd64,linux/arm64", "multi-platform OCI index", "each runnable child manifest",
    "docker.io/docker/buildkit-syft-scanner@sha256:",
  ]) {
    assert.ok(guide.includes(marker), marker);
  }
  assert.match(guide, /uninstall steward-run/u);
  assert.match(guide, /does not\s+remove[\s\S]*?controller/u);
  assert.doesNotMatch(guide, /`linux\/amd64` schedulable nodes/u);
  assert.doesNotMatch(guide, /--sbom=true|buildkit-syft-scanner:stable-1/u);
  assert.match(guide, /native[\s\S]*`linux\/amd64`[\s\S]*`linux\/arm64`/u);
  assert.match(guide, /legacy ApeLogic `steward-task\.yml` remains `linux\/amd64`-only/u);
  assert.match(guide, /^# steward-run v0\.5\.0 installation guide$/mu);
  assert.match(guide, /Historical release guide/u);
  assert.match(guide, /current installation guide/u);
  assert.match(readme, /v0\.6\.0 installation and integration guide/u);
  assert.match(readme, /v0\.5\.0[\s\S]*?predates authentication discovery/u);
  assert.match(arcReadme, /v0\.6\.0[\s\S]*?authentication discovery/u);
  assert.match(arcReadme, /historical v0\.5\.0 guide/u);
  assert.match(guide, /steward-run-arc-preflight\.mjs/u);
  assert.match(guide, /controllerServiceAccount/u);
  assert.match(guide, /arc-gha-rs-controller/u);
  assert.match(guide, /sha256sum -c SHA256SUMS/u);
  assert.match(guide, /cosign verify/u);
  assert.doesNotMatch(rebuild, /release workflow and DEV handoff remain unchanged/u);
  assert.match(rebuild, /current installation guide/u);
  assert.match(rebuild, /intentionally duplicates\s+no shell commands/u);
  for (const section of [
    "Prerequisites",
    "Authentication discovery contract",
    "Minimal reusable-workflow integration",
    "Deprecated compatibility inputs",
    "ARC installation and optional public CA bundle",
    "Upgrade and rollback",
    "Verification",
    "Documentation inventory",
  ]) {
    assert.match(current, new RegExp(`## ${section}`, "u"));
  }
  assert.match(current, /github_oidc_audience/u);
  assert.match(current, /default: `?""`?/u);
  assert.match(current, /separately reviewed major-version/u);
});

test("the public and fork tracks converge on one packaged-chart runbook", async () => {
  const guide = await readFile(new URL("../docs/installation-v0.5.0.md", import.meta.url), "utf8");
  const publicTrack = guide.indexOf("#### Track A — consume the public v0.5.0 release");
  const forkTrack = guide.indexOf("#### Track B — build and publish from a customer fork");
  const commonInstall = guide.indexOf("### 2. Install or verify the shared ARC controller");
  const prepareValues = guide.indexOf("cat > customer-values.yaml <<YAML");
  const firstValuesCommand = guide.indexOf('helm lint "$CHART_PACKAGE" --strict --values customer-values.yaml');

  assert.ok(publicTrack >= 0 && forkTrack > publicTrack && commonInstall > forkTrack);
  assert.ok(guide.indexOf('IMAGE_REFERENCE="$(jq -er', publicTrack) < forkTrack);
  assert.ok(guide.indexOf('CHART_PACKAGE="$PWD/steward-run-arc-$RELEASE_VERSION.tgz"', publicTrack) < forkTrack);
  assert.ok(guide.indexOf('WORKFLOW_COMMIT="$(jq -er', publicTrack) < forkTrack);
  assert.ok(guide.indexOf('IMAGE_REFERENCE="$IMAGE_REPOSITORY@$IMAGE_DIGEST"', forkTrack) < commonInstall);
  assert.ok(guide.indexOf('CHART_PACKAGE="$PWD/dist/steward-run-arc-$SOURCE_VERSION.tgz"', forkTrack) < commonInstall);
  assert.ok(guide.indexOf('WORKFLOW_COMMIT="$SOURCE_COMMIT"', forkTrack) < commonInstall);
  assert.ok(prepareValues >= 0 && prepareValues < firstValuesCommand);
  assert.match(guide, /helm install "\$ARC_CONTROLLER_RELEASE"[\s\S]*?gha-runner-scale-set-controller[\s\S]*?--version "\$ARC_CONTROLLER_VERSION"/u);
  assert.match(guide, /install steward-run "\$CHART_PACKAGE"/u);
  assert.match(guide, /upgrade steward-run "\$CHART_PACKAGE"/u);
  assert.doesNotMatch(guide.slice(commonInstall), /(?:install|upgrade) steward-run charts\/steward-run-arc/u);
  assert.doesNotMatch(guide, /issue #43/u);
  for (const tool of ["Helm `3.17+`", "`kubectl`", "`curl`", "`jq`", "Node.js `24`", "Cosign `3.1+`"]) {
    assert.ok(guide.includes(tool), `prerequisite: ${tool}`);
  }
});

test("current authentication docs and interfaces cannot drift", async () => {
  const root = new URL("..", import.meta.url).pathname;
  const [guide, readme, specification, actionSource, arcReadme, libraryReadme, releaseNotes, arcFixtureSource, libraryValuesSource] = await Promise.all([
    readFile(new URL("../docs/installation.md", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/steward-run-spec.md", import.meta.url), "utf8"),
    readFile(new URL("../action.yml", import.meta.url), "utf8"),
    readFile(new URL("../charts/steward-run-arc/README.md", import.meta.url), "utf8"),
    readFile(new URL("../charts/steward-run/README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/release-notes-v0.6.0.md", import.meta.url), "utf8"),
    readFile(new URL("fixtures/arc-ca-values.yaml", import.meta.url), "utf8"),
    readFile(new URL("../charts/steward-run/values.yaml", import.meta.url), "utf8"),
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
  for (const file of ["steward-task.yml", "steward-task-self-hosted.yml", "steward-task-customer.yml"]) {
    const source = await readFile(resolve(root, ".github", "workflows", file), "utf8");
    const workflow = parse(source) as { on: { workflow_call: { inputs: Record<string, { required?: boolean; default?: string }> } } };
    for (const name of compatibility) {
      assert.notEqual(workflow.on.workflow_call.inputs[name]?.required, true, `${file}:${name}`);
      assert.equal(workflow.on.workflow_call.inputs[name]?.default, "", `${file}:${name}`);
    }
  }
  assert.match(guide, /audience without[\s\S]*explicit URL is rejected/u);
  assert.match(guide, /explicit exchange[\s\S]*bypasses discovery/u);
  assert.match(guide, /system trust/u);
  assert.match(guide, /64 KiB/u);
  assert.match(guide, /five-second timeout/u);
  assert.match(guide, /ten-second budget/u);

  const documents = [
    [new URL("../README.md", import.meta.url), readme],
    [new URL("../docs/installation.md", import.meta.url), guide],
    [new URL("../docs/steward-run-spec.md", import.meta.url), specification],
    [new URL("../docs/release-notes-v0.6.0.md", import.meta.url), releaseNotes],
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

  const guideYaml = [...guide.matchAll(/```yaml\n([\s\S]*?)```/gu)].map((match) => parse(match[1] ?? "") as Record<string, any>);
  const arcExample = guideYaml.find((example) => example["gha-runner-scale-set"]);
  const arcFixture = parse(arcFixtureSource) as Record<string, any>;
  const examplePod = arcExample?.["gha-runner-scale-set"]?.template?.spec;
  const fixturePod = arcFixture["gha-runner-scale-set"]?.template?.spec;
  assert.deepEqual(examplePod?.volumes, fixturePod?.volumes);
  assert.deepEqual(examplePod?.containers?.[0]?.env, fixturePod?.containers?.[0]?.env);
  assert.deepEqual(examplePod?.containers?.[0]?.volumeMounts, fixturePod?.containers?.[0]?.volumeMounts);

  const libraryYaml = [...libraryReadme.matchAll(/```yaml\n([\s\S]*?)```/gu)].map((match) => parse(match[1] ?? "") as Record<string, any>);
  const libraryExample = libraryYaml.find((example) => example.stewardRun);
  const libraryValues = parse(libraryValuesSource) as Record<string, any>;
  assert.deepEqual(libraryExample?.stewardRun?.trustBundle, libraryValues.trustBundle);
});
