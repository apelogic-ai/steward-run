import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("README leads to the versioned, honest customer installation guide", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const guide = await readFile(new URL("../docs/installation-v0.4.0.md", import.meta.url), "utf8");
  assert.match(readme, /docs\/installation-v0\.4\.0\.md/u);
  assert.match(readme, /ARC controller[\s\S]*?external/u);
  assert.match(readme, /steward-run-arc/u);
  assert.doesNotMatch(readme, /this private source repository|There is currently no public steward-run runner image or OCI chart/u);
  for (const section of ["Prerequisites", "Installation", "Post-install", "Upgrade", "Rollback", "Delivery tests", "Integration and object inventory"]) {
    assert.match(guide, new RegExp(`## ${section}`, "u"));
  }
  for (const marker of [
    "github_app_id", "github_app_installation_id", "github_app_private_key",
    "--from-file", "id-token: write", "steward-run-github-app", "imagePullSecrets",
    "ca.crt", "0.14.2", "2.336.0", "GitHub.com", "not yet live-tested",
  ]) {
    assert.ok(guide.includes(marker), marker);
  }
  assert.match(guide, /uninstall steward-run/u);
  assert.match(guide, /does not\s+remove[\s\S]*?controller/u);
});
