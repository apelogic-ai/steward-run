import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("README leads to the versioned, honest customer installation guide", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const guide = await readFile(new URL("../docs/installation-v0.4.2.md", import.meta.url), "utf8");
  const rebuild = await readFile(new URL("../docs/customer-rebuild.md", import.meta.url), "utf8");
  assert.match(readme, /docs\/installation-v0\.4\.2\.md/u);
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
  assert.match(guide, /^# steward-run v0\.4\.2 installation guide$/mu);
  assert.doesNotMatch(rebuild, /release workflow and DEV handoff remain unchanged/u);
  assert.match(rebuild, /native per-platform release workflow/u);
});

test("the installation guide prepares customer values before the first values-dependent command", async () => {
  const guide = await readFile(new URL("../docs/installation-v0.4.2.md", import.meta.url), "utf8");
  const prepareValues = guide.indexOf(
    "Copy `charts/steward-run-arc/values.yaml` to `customer-values.yaml`.",
  );
  const firstValuesCommand = guide.indexOf(
    "helm lint charts/steward-run-arc --strict --values customer-values.yaml",
  );

  assert.ok(prepareValues >= 0, "guide must prepare customer-values.yaml");
  assert.ok(firstValuesCommand >= 0, "guide must lint customer-values.yaml");
  assert.ok(
    prepareValues < firstValuesCommand,
    "guide must prepare customer-values.yaml before using it",
  );
});
