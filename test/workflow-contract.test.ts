import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

const workflowFiles = ["ci.yml", "roundtrip.yml", "release.yml", "steward-task.yml", "steward-task-self-hosted.yml"];
const governedJobContainer =
  "663383948333.dkr.ecr.us-east-1.amazonaws.com/steward-run@" +
  "sha256:27235891b596debb1d8bba5f7763e14a56ce4435e2fc82f3de80122b19ff8c61";
const actionCommit = "b114d38dd6d4c300a7bf80ec16567027dd5d4be1";
const directPackageActionCommit = "b114d38dd6d4c300a7bf80ec16567027dd5d4be1";

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
  assert.match(roundtrip, /workflow:\s*repository-review@1/);
  assert.match(roundtrip, /inputs:\s*in/);
  assert.match(roundtrip, /outputs:\s*out/);
  assert.match(roundtrip, /status.*succeeded/);
  assert.match(roundtrip, /task-uid/);
  assert.match(roundtrip, /runtime-uid.*mock-runtime-uid/);
  assert.match(roundtrip, /identity-exchange-url:\s*\$\{\{ steps\.mock\.outputs\.url \}\}\/v1\/exchange/);
  assert.doesNotMatch(roundtrip, /oidc-audience:/);
  assert.doesNotMatch(roundtrip, /ACTIONS_ID_TOKEN_REQUEST_(?:URL|TOKEN):/u);
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

test("the reusable ARC workflow transfers artifacts around an immutable remote action", async () => {
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
    jobs: Record<
      string,
      {
        container?: { image?: string; credentials?: unknown };
        permissions?: Record<string, string>;
        "runs-on"?: string;
        "timeout-minutes"?: number;
      }
    >;
  };

  assert.ok(workflow.on.workflow_call);
  assert.deepEqual(
    Object.keys(workflow.on.workflow_call.inputs).sort(),
    [
      "agent-runtime",
      "identity-exchange-audience",
      "identity-exchange-url",
      "input-artifact",
      "invocation-path",
      "output-artifact",
      "runner-label",
      "steward-api-url",
      "steward-ca-certificate-file",
      "workflow",
    ].sort(),
  );
  for (const name of [
    "identity-exchange-url",
    "identity-exchange-audience",
    "input-artifact",
    "output-artifact",
    "runner-label",
    "steward-api-url",
  ]) {
    assert.equal(workflow.on.workflow_call.inputs[name]?.type, "string", name);
  }
  assert.equal(workflow.on.workflow_call.inputs["coding-agent-runtime"], undefined);
  assert.equal(workflow.on.workflow_call.inputs["action-commit"], undefined);
  assert.equal(workflow.on.workflow_call.inputs["identity-exchange-url"]?.required, true);
  assert.equal(workflow.on.workflow_call.inputs["identity-exchange-audience"]?.required, true);
  assert.equal(workflow.on.workflow_call.inputs["runner-label"]?.required, true);
  assert.notEqual(workflow.on.workflow_call.inputs["invocation-path"]?.required, true);
  assert.notEqual(workflow.on.workflow_call.inputs.workflow?.required, true);
  assert.deepEqual(
    Object.keys(workflow.on.workflow_call.outputs).sort(),
    ["runtime-uid", "status", "task-uid"],
  );

  const job = workflow.jobs.governed;
  assert.equal(job?.permissions?.contents, "read");
  assert.equal(job?.permissions?.["id-token"], "write");
  assert.equal(job?.["runs-on"], "${{ inputs.runner-label }}");
  assert.equal(job?.["timeout-minutes"], 15);
  const containerImage = job?.container?.image ?? "";
  assert.equal(containerImage, governedJobContainer);
  assert.equal(job?.container?.credentials, undefined);
  assert.match(
    containerImage,
    /^\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/u,
  );
  assert.doesNotMatch(containerImage, /\$\{\{/u);
  assert.doesNotMatch(containerImage.split("@", 1)[0] ?? "", /:[^/]+$/u);
  assert.equal(workflow.on.workflow_call.inputs["container-image"], undefined);
  assert.equal(workflow.on.workflow_call.inputs["job-container-image"], undefined);
  assert.match(source, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u);
  assert.match(source, /if:\s*inputs\.invocation-path != ''/u);
  assert.match(source, /ref:\s*\$\{\{ github\.sha \}\}/u);
  assert.match(source, /persist-credentials:\s*false/u);
  assert.doesNotMatch(source, /inputs\.action-commit|\.steward-run-action/u);
  assert.match(source, /actions\/download-artifact@/);
  assert.match(source, /name:\s*\$\{\{ inputs\.input-artifact \}\}/);
  assert.match(source, /path:\s*in/);
  assert.match(
    source,
    new RegExp(`uses:\\s*apelogic-ai/steward-run@${actionCommit}`, "u"),
  );
  assert.doesNotMatch(source, /uses:\s*apelogic-ai\/steward-run@\$\{\{/u);
  assert.match(source, /identity-exchange-url:\s*\$\{\{ inputs\.identity-exchange-url \}\}/);
  assert.match(
    source,
    /identity-exchange-audience:\s*\$\{\{ inputs\.identity-exchange-audience \}\}/u,
  );
  assert.match(source, /inputs:\s*in/);
  assert.match(source, /outputs:\s*out/);
  assert.match(source, /invocation-path:\s*\$\{\{ inputs\.invocation-path \}\}/u);
  assert.match(source, /workflow:\s*\$\{\{ inputs\.workflow \}\}/u);
  assert.doesNotMatch(source, /coding-agent-runtime|codingAgentRuntime/u);
  assert.match(source, /actions\/upload-artifact@/);
  assert.match(source, /name:\s*\$\{\{ inputs\.output-artifact \}\}/);
  assert.match(source, /path:\s*out/);
  assert.doesNotMatch(source, /oidc-audience|bearer-token|identity\.dev|cluster|secret/iu);

  const checkout = source.indexOf("actions/checkout@");
  const download = source.indexOf("actions/download-artifact@");
  const action = source.indexOf(`uses: apelogic-ai/steward-run@${actionCommit}`);
  const upload = source.indexOf("actions/upload-artifact@");
  assert.ok(checkout >= 0 && checkout < download && download < action && action < upload);
});

test("the self-hosted reusable workflow preserves GitHub OIDC provenance without an ECR job container", async () => {
  const source = await readFile(
    new URL("../.github/workflows/steward-task-self-hosted.yml", import.meta.url),
    "utf8",
  );
  const workflow = parse(source) as {
    on: {
      workflow_call: {
        inputs: Record<string, { required?: boolean }>;
        outputs: Record<string, unknown>;
      };
    };
    jobs: Record<string, { container?: unknown; permissions?: Record<string, string>; "runs-on"?: string; "timeout-minutes"?: number }>;
  };

  assert.ok(workflow.on.workflow_call);
  assert.deepEqual(Object.keys(workflow.on.workflow_call.outputs).sort(), ["runtime-uid", "status", "task-uid"]);
  assert.equal(workflow.jobs.governed?.["runs-on"], "${{ inputs.runner-label }}");
  assert.equal(workflow.jobs.governed?.["timeout-minutes"], 15);
  assert.equal(workflow.jobs.governed?.permissions?.contents, "read");
  assert.equal(workflow.jobs.governed?.permissions?.["id-token"], "write");
  assert.equal(workflow.jobs.governed?.container, undefined);
  assert.equal(workflow.on.workflow_call.inputs["identity-exchange-audience"]?.required, true);
  assert.notEqual(workflow.on.workflow_call.inputs["invocation-path"]?.required, true);
  assert.notEqual(workflow.on.workflow_call.inputs.workflow?.required, true);
  assert.match(
    source,
    new RegExp(`uses:\\s*apelogic-ai/steward-run@${directPackageActionCommit}`, "u"),
  );
  assert.match(source, /actions\/download-artifact@/);
  assert.match(source, /actions\/upload-artifact@/);
  assert.match(source, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u);
  assert.match(source, /if:\s*inputs\.invocation-path != ''/u);
  assert.match(source, /persist-credentials:\s*false/u);
  assert.match(
    source,
    /identity-exchange-audience:\s*\$\{\{ inputs\.identity-exchange-audience \}\}/u,
  );
  assert.match(source, /invocation-path:\s*\$\{\{ inputs\.invocation-path \}\}/u);
  assert.doesNotMatch(source, /amazonaws\.com|container:|bearer-token|identity\.dev|cluster|secret/iu);
});

test("CI and release execute the governed job-container runtime contract", async () => {
  const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const release = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  for (const capability of ["/bin/bash", "command -v node", "command -v git", "command -v tar"])
    assert.match(ci, new RegExp(capability.replaceAll("/", "\\/"), "u"));
  assert.match(ci, /\/home\/runner\/externals\/node20\/bin\/node --version/u);
  assert.match(ci, /node \/workspace\/dist\/index\.cjs/u);
  const ciContainerProbe = ci.slice(
    ci.indexOf("- name: Smoke-test ARC and governed job-container contracts"),
    ci.indexOf("- name: Export image vulnerability report"),
  );
  assert.ok(ciContainerProbe.indexOf('-v "${{ github.workspace }}:/workspace:ro"') >= 0);
  assert.ok(ciContainerProbe.indexOf('-v "${{ github.workspace }}:/workspace:ro"') <
    ciContainerProbe.indexOf("steward-run:ci"));
  assert.match(release, new RegExp(governedJobContainer.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(release, /Verify governed job-container image/u);
  assert.match(release, /node \/workspace\/dist\/index\.cjs/u);
});

test("release gates semantic tags on signed scan evidence for the runnable image", async () => {
  const release = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const scanGate = release.indexOf("- name: Require completed ECR scan for runnable image");
  const signing = release.indexOf("- name: Sign and verify immutable release artifacts");
  const semanticPromotion = release.indexOf("- name: Promote verified candidate to semantic image tag");

  assert.ok(scanGate >= 0);
  assert.ok(scanGate < signing);
  assert.ok(signing < semanticPromotion);
  assert.match(release, /aws ecr wait image-scan-complete/u);
  assert.match(release, /scripts\/resolve-runnable-image-digest\.mjs/u);
  assert.match(release, /scripts\/write-ecr-scan-summary\.mjs/u);
  assert.match(release, /ecr-image-scan-summary\.sigstore\.json/u);
  assert.doesNotMatch(
    release.slice(scanGate, semanticPromotion),
    /imageTag=\$VERSION|:\$VERSION/u,
  );
});

test("mock OIDC routing is isolated from production workflows", async () => {
  const productionSources = await Promise.all(
    ["../action.yml", "../.github/workflows/ci.yml", "../.github/workflows/release.yml", "../.github/workflows/steward-task.yml"].map(
      (path) => readFile(new URL(path, import.meta.url), "utf8"),
    ),
  );
  for (const source of productionSources) {
    assert.doesNotMatch(source, /request-secret|\/oidc\?api-version=1/u);
  }
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
  assert.match(readme, /docs\/installation-v0\.4\.0\.md/u);
  assert.doesNotMatch(readme, /uses:\s*apelogic-ai\/steward-run\/\.github\/workflows\/steward-task\.yml/u);
  assert.doesNotMatch(readme, /action-commit:/u);
  assert.match(releaseWorkflow, new RegExp(`ACTION_COMMIT:\\s*${actionCommit}`, "u"));
  assert.match(
    releaseWorkflow,
    /Reusable workflow:.*steward-task\.yml@\$GITHUB_SHA/u,
  );
  assert.match(releaseWorkflow, /Action commit:.*\$ACTION_COMMIT/u);
});

test("failure diagnostics are versioned, bounded, and GitHub-visible", async () => {
  const [readme, specification, main, metadata] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/steward-run-spec.md", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/failure-metadata.ts", import.meta.url), "utf8"),
  ]);
  for (const document of [readme, specification]) {
    assert.match(document, /steward-run\.failure\/v1/u);
    assert.match(document, /steward-run\.assertion-stage\/v1/u);
    assert.match(document, /provider-connection/u);
    assert.match(document, /provider-grant/u);
    assert.match(document, /provider-protocol/u);
    assert.match(document, /workflow-cleanup/u);
    assert.match(document, /confirmation-timeout/u);
    assert.match(document, /Raw Steward reasons|Arbitrary failure reasons/u);
  }
  assert.match(main, /GITHUB_STEP_SUMMARY/u);
  assert.match(main, /::error title=Steward governed Task failed::/u);
  assert.doesNotMatch(main, /error instanceof Error \? error\.message : String\(error\)/u);
  assert.match(metadata, /FAILURE_METADATA_VERSION = "steward-run\.failure\/v1"/u);
  assert.match(
    metadata,
    /ASSERTION_STAGE_METADATA_VERSION = "steward-run\.assertion-stage\/v1"/u,
  );
});
