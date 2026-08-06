import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

const workflowFiles = ["ci.yml", "roundtrip.yml", "release.yml", "steward-task.yml"];

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
  assert.match(ci, /trivy-report\.json/);
  assert.match(ci, /vulnerability-summary\.json/);
  assert.match(ci, /check-vulnerability-report\.mjs/);
  assert.match(ci, /name:\s*steward-run-vulnerability-report/);
  assert.match(ci, /if:\s*always\(\)/);
  assert.doesNotMatch(ci, /--ignore-unfixed/);

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
  assert.match(roundtrip, /task-uid/);
  assert.match(roundtrip, /runtime-uid.*mock-runtime-uid/);
  assert.match(roundtrip, /identity-exchange-url:\s*\$\{\{ steps\.mock\.outputs\.url \}\}\/v1\/exchange/);
  assert.doesNotMatch(roundtrip, /oidc-audience:/);
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
  assert.equal(release.permissions.contents, "write");
  assert.match(releaseSource, /AWS_ROLE_ARN/);
  assert.match(
    releaseSource,
    /sigstore\/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6/,
  );
  assert.match(releaseSource, /workflow_dispatch:/);
  assert.doesNotMatch(releaseSource, /types:\s*\[published\]/);
  assert.doesNotMatch(releaseSource, /^\s+environment:/mu);
  assert.match(releaseSource, /group:\s*release-\$\{\{ inputs\.version \}\}/);
  assert.match(releaseSource, /cancel-in-progress:\s*false/);
  assert.match(releaseSource, /cosign-release:\s*v3\.1\.2/);
  assert.match(releaseSource, /--provenance=mode=max/);
  assert.match(releaseSource, /--sbom=true/);
  assert.match(releaseSource, /containerimage\.digest/);
  assert.match(
    releaseSource,
    /candidate-\$REQUESTED_VERSION-\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT/,
  );
  assert.match(releaseSource, /cosign sign --yes/);
  assert.doesNotMatch(releaseSource, /--registry-referrers-mode=legacy/);
  assert.match(releaseSource, /COSIGN_EXPERIMENTAL:\s*"1"/);
  assert.match(
    releaseSource,
    /cosign sign --yes \\\n\s+--bundle image-signature\.sigstore\.json \\\n\s+--registry-referrers-mode=oci-1-1/,
  );
  assert.match(
    releaseSource,
    /cosign verify \\\n\s+--experimental-oci11=true/,
  );
  assert.doesNotMatch(releaseSource, /--upload=false/);
  assert.doesNotMatch(releaseSource, /--new-bundle-format=false/);
  assert.doesNotMatch(releaseSource, /--use-signing-config=false/);
  assert.match(
    releaseSource,
    /cosign verify-blob \\\n\s+--bundle image-signature\.sigstore\.json[\s\S]+?"\$IMAGE_DIGEST"/,
  );
  assert.match(releaseSource, /for attempt in \{1\.\.6\}/);
  assert.match(releaseSource, /sleep 10/);
  assert.match(releaseSource, /cosign sign-blob --yes/);
  assert.match(releaseSource, /release-manifest\.json/);
  assert.match(releaseSource, /release-manifest\.sigstore\.json/);
  assert.match(releaseSource, /GITHUB_SHA/);
  assert.match(releaseSource, /docker buildx imagetools create/);
  assert.match(releaseSource, /aws ecr batch-get-image/);
  assert.doesNotMatch(releaseSource, /aws ecr list-images/);
  assert.doesNotMatch(releaseSource, /aws ecr describe-images/);
  assert.match(releaseSource, /gh release create "v\$VERSION"/);
  assert.match(releaseSource, /\[\[ "\$GITHUB_REF" == refs\/heads\/main \]\]/);
  assert.match(releaseSource, /git\/matching-refs\/tags\/v\$REQUESTED_VERSION/);
  assert.match(releaseSource, /require\("\.\/package\.json"\)\.version/);
  const releaseValidation = releaseSource.indexOf("- name: Validate release request");
  const awsCredentials = releaseSource.indexOf("aws-actions/configure-aws-credentials@");
  assert.ok(releaseValidation >= 0);
  assert.ok(releaseValidation < awsCredentials);
  const candidateBuild = releaseSource.indexOf('--tag "$IMAGE_REPOSITORY:$CANDIDATE_TAG"');
  const bundleSign = releaseSource.indexOf("--bundle image-signature.sigstore.json");
  const bundleVerification = releaseSource.indexOf("cosign verify-blob", bundleSign + 1);
  const registryVerification = releaseSource.indexOf("--experimental-oci11=true");
  const signatureVerification = releaseSource.indexOf('[[ "$registry_verified" == true ]]');
  const finalImageTag = releaseSource.indexOf("docker buildx imagetools create");
  const finalReleaseTag = releaseSource.indexOf('gh release create "v$VERSION"');
  assert.ok(candidateBuild >= 0);
  assert.ok(candidateBuild < bundleSign);
  assert.ok(bundleSign < bundleVerification);
  assert.ok(bundleVerification < registryVerification);
  assert.ok(registryVerification < signatureVerification);
  assert.ok(signatureVerification < finalImageTag);
  assert.ok(finalImageTag < finalReleaseTag);
  assert.match(
    releaseSource,
    /uses: actions\/upload-artifact@[a-f0-9]{40}[\s\S]+?if:\s*\$\{\{ always\(\) && hashFiles\('release-metadata\.json'\) != '' \}\}/,
  );
  assert.doesNotMatch(releaseSource, /--tag[^\n]*latest/);
});

test("the reusable ARC workflow transfers artifacts around an immutable action checkout", async () => {
  const source = await readFile(
    new URL("../.github/workflows/steward-task.yml", import.meta.url),
    "utf8",
  );
  const workflow = parse(source) as {
    on: {
      workflow_call: {
        inputs: Record<string, { required?: boolean; type?: string }>;
        outputs: Record<string, unknown>;
      };
    };
    jobs: Record<string, { permissions?: Record<string, string>; "runs-on"?: string }>;
  };

  assert.ok(workflow.on.workflow_call);
  for (const name of [
    "action-commit",
    "coding-agent-runtime",
    "identity-exchange-url",
    "input-artifact",
    "output-artifact",
    "runner-label",
    "steward-api-url",
    "workflow",
  ]) {
    assert.equal(workflow.on.workflow_call.inputs[name]?.type, "string", name);
  }
  assert.equal(workflow.on.workflow_call.inputs["action-commit"]?.required, true);
  assert.equal(workflow.on.workflow_call.inputs["identity-exchange-url"]?.required, true);
  assert.equal(workflow.on.workflow_call.inputs["runner-label"]?.required, true);
  assert.deepEqual(
    Object.keys(workflow.on.workflow_call.outputs).sort(),
    ["runtime-uid", "status", "task-uid"],
  );

  const job = workflow.jobs.governed;
  assert.equal(job?.permissions?.contents, "read");
  assert.equal(job?.permissions?.["id-token"], "write");
  assert.equal(job?.["runs-on"], "${{ inputs.runner-label }}");
  assert.match(source, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(source, /repository:\s*apelogic-ai\/steward-run/);
  assert.match(source, /ref:\s*\$\{\{ inputs\.action-commit \}\}/);
  assert.match(source, /actions\/download-artifact@/);
  assert.match(source, /name:\s*\$\{\{ inputs\.input-artifact \}\}/);
  assert.match(source, /path:\s*in/);
  assert.match(source, /uses:\s*\.\/\.steward-run-action/);
  assert.match(source, /identity-exchange-url:\s*\$\{\{ inputs\.identity-exchange-url \}\}/);
  assert.match(source, /inputs:\s*in/);
  assert.match(source, /outputs:\s*out/);
  assert.match(source, /actions\/upload-artifact@/);
  assert.match(source, /name:\s*\$\{\{ inputs\.output-artifact \}\}/);
  assert.match(source, /path:\s*out/);
  assert.doesNotMatch(source, /oidc-audience|bearer-token|identity\.dev|cluster|secret/iu);

  const download = source.indexOf("actions/download-artifact@");
  const action = source.indexOf("uses: ./.steward-run-action");
  const upload = source.indexOf("actions/upload-artifact@");
  assert.ok(download >= 0 && download < action && action < upload);
});

test("production handoffs pin the reusable workflow to the release commit", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const specification = await readFile(
    new URL("../docs/steward-run-spec.md", import.meta.url),
    "utf8",
  );
  const releaseWorkflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const productionHandoffs = `${readme}\n${specification}\n${releaseWorkflow}`;

  assert.doesNotMatch(productionHandoffs, /steward-task\.yml@main/u);
  assert.match(
    readme,
    /apelogic-ai\/steward-run\/\.github\/workflows\/steward-task\.yml@<IMMUTABLE_RELEASE_COMMIT>/u,
  );
  assert.match(
    releaseWorkflow,
    /Reusable workflow:.*steward-task\.yml@\$GITHUB_SHA/u,
  );
});
