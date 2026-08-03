import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

const workflowFiles = ["ci.yml", "roundtrip.yml", "release.yml"];

test("all external workflow actions are pinned to immutable commits", async () => {
  for (const file of workflowFiles) {
    const source = await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8");
    for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)) {
      const reference = match[1] ?? "";
      if (reference.startsWith("./")) continue;
      assert.match(reference, /@[a-f0-9]{40}$/u, `${file}: ${reference}`);
    }
    assert.doesNotMatch(source, /:latest\b|@(?:main|master|v\d+)\b/u);
  }
});

test("CI, round-trip, and release workflows enforce the product contract", async () => {
  const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /npm run check/);
  assert.match(ci, /gitleaks\/gitleaks:v8\.30\.1@sha256:/);
  assert.match(ci, /aquasec\/trivy:0\.72\.0@sha256:/);
  assert.match(ci, /docker build/);

  const roundtrip = await readFile(
    new URL("../.github/workflows/roundtrip.yml", import.meta.url),
    "utf8",
  );
  assert.match(roundtrip, /id-token:\s*write/);
  assert.match(roundtrip, /runs-on:\s*ubuntu-24\.04/);
  assert.match(roundtrip, /actions\/download-artifact@/);
  assert.match(roundtrip, /uses:\s*\.\//);
  assert.match(roundtrip, /actions\/upload-artifact@/);
  assert.match(roundtrip, /workflow:\s*copy-smoke/);
  assert.match(roundtrip, /inputs:\s*in/);
  assert.match(roundtrip, /outputs:\s*out/);
  assert.match(roundtrip, /status.*succeeded/);
  assert.match(roundtrip, /runtime-uid.*mock-runtime-uid/);
  assert.match(roundtrip, /mock-finalized/);
  assert.match(roundtrip, /in\/payload\.bin/);
  assert.match(roundtrip, /out\/payload\.bin/);
  assert.match(roundtrip, /\bcmp\b/);
  assert.match(roundtrip, /sha256sum/);

  const releaseSource = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const release = parse(releaseSource) as { permissions: Record<string, string> };
  assert.equal(release.permissions["id-token"], "write");
  assert.match(releaseSource, /AWS_ROLE_ARN/);
  assert.match(releaseSource, /--provenance=mode=max/);
  assert.match(releaseSource, /--sbom=true/);
  assert.doesNotMatch(releaseSource, /--tag[^\n]*latest/);
});
