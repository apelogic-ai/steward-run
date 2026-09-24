import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("README leads to the versioned, honest customer installation guide", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const guide = await readFile(new URL("../docs/installation-v0.5.0.md", import.meta.url), "utf8");
  const rebuild = await readFile(new URL("../docs/customer-rebuild.md", import.meta.url), "utf8");
  assert.match(readme, /docs\/installation-v0\.5\.0\.md/u);
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
  assert.match(guide, /steward-run-arc-preflight\.mjs/u);
  assert.match(guide, /controllerServiceAccount/u);
  assert.match(guide, /arc-gha-rs-controller/u);
  assert.match(guide, /sha256sum -c SHA256SUMS/u);
  assert.match(guide, /cosign verify/u);
  assert.doesNotMatch(rebuild, /release workflow and DEV handoff remain unchanged/u);
  assert.match(rebuild, /Track B in the versioned installation guide/u);
  assert.match(rebuild, /intentionally duplicates\s+no shell commands/u);
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
