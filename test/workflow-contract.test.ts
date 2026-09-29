import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const governedJobContainer =
  "ghcr.io/apelogic-ai/steward-run@" +
  "sha256:7b2d9b13b83567ba8a9558c2a0cd275b7aec972efc88c122c95e8b54400df5b4";
const buildkitImage =
  "docker.io/moby/buildkit@" +
  "sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8";
test("reusable workflow job timeouts are configurable and bounded", async () => {
  for (const file of ["steward-task.yml", "steward-task-self-hosted.yml", "steward-task-customer.yml"]) {
    const source = await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8");
    const workflow = parse(source) as {
      on: { workflow_call: { inputs: Record<string, { default?: number; description?: string; type?: string }> } };
      jobs: { governed: { "timeout-minutes"?: string; steps?: Array<Record<string, any>> } };
    };
    const input = workflow.on.workflow_call.inputs["job-timeout-minutes"];
    assert.equal(input?.type, "number", file);
    assert.equal(input?.default, 15, file);
    assert.match(input?.description ?? "", /whole minutes \(1-360\)/u, file);
    assert.equal(workflow.jobs.governed["timeout-minutes"], "${{ inputs.job-timeout-minutes }}", file);

    const validation = workflow.jobs.governed.steps?.find((step) => step.name === "Validate job timeout");
    assert.ok(validation, file);
    assert.equal(validation.env?.JOB_TIMEOUT_MINUTES, "${{ inputs.job-timeout-minutes }}", file);
    assert.match(validation.run ?? "", /job-timeout-minutes must be an integer from 1 through 360/u, file);
    for (const value of ["1", "15", "360"]) {
      assert.doesNotThrow(
        () => execFileSync("bash", ["-c", validation.run], { env: { ...process.env, JOB_TIMEOUT_MINUTES: value } }),
        `${file}: ${value}`,
      );
    }
    for (const value of ["0", "361", "1.5", "-1", "not-a-number"]) {
      assert.throws(
        () => execFileSync("bash", ["-c", validation.run], { env: { ...process.env, JOB_TIMEOUT_MINUTES: value } }),
        `${file}: ${value}`,
      );
    }
  }
});

test("all external workflow actions are pinned to immutable commits", async () => {
  const workflowFiles = (await readdir(new URL("../.github/workflows", import.meta.url)))
    .filter((file) => /\.ya?ml$/iu.test(file));
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

test("reusable workflows safely replace only their own stale action checkout", async () => {
  for (const file of ["steward-task.yml", "steward-task-self-hosted.yml"]) {
    const source = await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8");
    const workflow = parse(source) as {
      jobs: { governed: { steps: Array<{ name?: string; env?: Record<string, string>; run?: string }> } };
    };
    const step = workflow.jobs.governed.steps.find(
      (candidate) => candidate.name === "Reserve the trusted action checkout path",
    );
    assert.ok(step?.run, file);
    assert.equal(step.env?.ACTION_CHECKOUT_PATH, ".steward-run-action", file);
    assert.equal(step.env?.WORKFLOW_REPOSITORY, "${{ job.workflow_repository }}", file);
    assert.equal(step.env?.WORKFLOW_SERVER_URL, "${{ github.server_url }}", file);

    const directory = await mkdtemp(join(tmpdir(), "steward-run-action-checkout-"));
    const actionPath = join(directory, ".steward-run-action");
    const environment = {
      ...process.env,
      ACTION_CHECKOUT_PATH: ".steward-run-action",
      WORKFLOW_REPOSITORY: "apelogic-ai/steward-run",
      WORKFLOW_SERVER_URL: "https://github.com",
    };
    const runReserve = () => execFileSync("bash", ["-c", step.run ?? ""], {
      cwd: directory,
      env: environment,
      stdio: "pipe",
    });

    try {
      assert.doesNotThrow(runReserve, `${file}: empty workspace`);

      await mkdir(actionPath);
      execFileSync("git", ["init", "-q"], { cwd: actionPath });
      execFileSync(
        "git",
        ["remote", "add", "origin", "https://github.com/apelogic-ai/steward-run"],
        { cwd: actionPath },
      );
      assert.doesNotThrow(runReserve, `${file}: stale owned checkout`);
      await assert.rejects(access(actionPath), `${file}: stale checkout removed`);

      await mkdir(join(directory, "symlink-target"));
      await symlink(join(directory, "symlink-target"), actionPath);
      assert.throws(runReserve, `${file}: symlink rejected`);
      await rm(actionPath);

      execFileSync("git", ["init", "-q"], { cwd: directory });
      await mkdir(actionPath);
      await writeFile(join(actionPath, "caller-owned.txt"), "tracked\n");
      execFileSync("git", ["add", ".steward-run-action/caller-owned.txt"], { cwd: directory });
      assert.throws(runReserve, `${file}: caller-tracked path rejected`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("public workflows and security evidence contain no private cloud account coordinates", async () => {
  const workflowFiles = (await readdir(new URL("../.github/workflows", import.meta.url)))
    .filter((file) => /\.ya?ml$/iu.test(file));
  const files = [
    ...workflowFiles.map((file) => new URL(`../.github/workflows/${file}`, import.meta.url)),
    new URL("../security/ecr-v0.1.0-critical-findings.json", import.meta.url),
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /\b\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\b/u);
  }
});

test("CI, round-trip, and portable release workflows enforce the product contract", async () => {
  const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const releaseSource = await readFile(
    new URL("../.github/workflows/portable-release.yml", import.meta.url),
    "utf8",
  );
  assert.match(ci, /npm run check/);
  assert.match(ci, /gitleaks\/gitleaks:v8\.30\.1@sha256:/);
  assert.match(ci, /aquasec\/trivy:0\.72\.0@sha256:/);
  assert.match(ci, /docker build/);
  assert.match(ci, /docker\/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f/);
  assert.ok(ci.includes(`driver-opts: image=${buildkitImage}`));
  assert.doesNotMatch(ci, /moby\/buildkit:buildx-stable-1/u);
  assert.match(ci, /architecture:\s*amd64[\s\S]+?runner:\s*ubuntu-24\.04/u);
  assert.match(ci, /architecture:\s*arm64[\s\S]+?runner:\s*ubuntu-24\.04-arm/u);
  assert.match(ci, /runs-on:\s*\$\{\{ matrix\.runner \}\}/u);
  assert.match(ci, /\[\[ "\$\(uname -m\)" == "\$\{\{ matrix\.hostArchitecture \}\}" \]\]/u);
  assert.match(ci, /--platform linux\/\$\{\{ matrix\.architecture \}\}/u);
  assert.match(ci, /steward-run-vulnerability-report-\$\{\{ matrix\.architecture \}\}-\$\{\{ github\.sha \}\}/u);
  assert.match(ci, /trivy-report-\$\{\{ matrix\.architecture \}\}\.json/u);
  assert.match(ci, /vulnerability-summary-\$\{\{ matrix\.architecture \}\}\.json/u);
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

  const release = parse(releaseSource) as {
    permissions?: Record<string, string>;
    jobs: Record<string, { permissions?: Record<string, string> }>;
  };
  assert.deepEqual(release.permissions, { contents: "read" });
  assert.deepEqual(release.jobs["build-amd64"]!.permissions, {
    contents: "read",
    packages: "write",
  });
  assert.deepEqual(release.jobs["build-arm64"]!.permissions, {
    contents: "read",
    packages: "write",
  });
  assert.deepEqual(release.jobs.publish!.permissions, {
    contents: "write",
    packages: "write",
    "id-token": "write",
  });
  const releaseCheckouts = releaseSource.match(/uses: actions\/checkout@[a-f0-9]{40}/gu) ?? [];
  const nonPersistingCheckouts = releaseSource.match(/persist-credentials:\s*false/gu) ?? [];
  assert.equal(nonPersistingCheckouts.length, releaseCheckouts.length);
  assert.doesNotMatch(
    releaseSource,
    /aws-actions\/configure-aws-credentials|AWS_ROLE_ARN|ECR_REGISTRY|ECR_REPOSITORY|aws ecr/iu,
  );
  assert.match(releaseSource, /workflow_dispatch:/);
  assert.match(releaseSource, /push:[\s\S]*?tags:/u);
  assert.match(releaseSource, /group:\s*portable-release-\$\{\{ github\.ref \}\}/);
  assert.match(releaseSource, /cancel-in-progress:\s*false/);
  assert.match(releaseSource, /check-public-release-assets\.mjs/u);
  const assetCheck = releaseSource.indexOf("check-public-release-assets.mjs");
  const publication = releaseSource.indexOf('gh release create "v$VERSION"');
  assert.ok(assetCheck >= 0);
  assert.ok(assetCheck < publication);
});

test("the reusable ARC workflow transfers artifacts around an immutable remote action", async () => {
  const source = await readFile(
    new URL("../.github/workflows/steward-task.yml", import.meta.url),
    "utf8",
  );
  const workflow = parse(source) as {
    on: {
      workflow_call: {
        inputs: Record<string, { required?: boolean; type?: string; default?: string | number }>;
        outputs: Record<string, unknown>;
      };
    };
    jobs: Record<
      string,
      {
        container?: { image?: string; credentials?: unknown };
        permissions?: Record<string, string>;
        "runs-on"?: string;
        "timeout-minutes"?: string;
        outputs?: Record<string, string>;
      }
    >;
  };

  assert.ok(workflow.on.workflow_call);
  assert.deepEqual(
    Object.keys(workflow.on.workflow_call.inputs).sort(),
    [
      "agent-runtime",
      "envelope-digest",
      "identity-exchange-audience",
      "identity-exchange-url",
      "input-artifact",
      "invocation-path",
      "job-timeout-minutes",
      "output-artifact",
      "runner-label",
      "runtime-binding-timeout-minutes",
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
  for (const name of [
    "identity-exchange-url",
    "identity-exchange-audience",
    "steward-ca-certificate-file",
  ]) {
    assert.notEqual(workflow.on.workflow_call.inputs[name]?.required, true, name);
    assert.equal(workflow.on.workflow_call.inputs[name]?.default, "", name);
  }
  assert.equal(workflow.on.workflow_call.inputs["runner-label"]?.required, true);
  assert.equal(workflow.on.workflow_call.inputs["job-timeout-minutes"]?.type, "number");
  assert.equal(workflow.on.workflow_call.inputs["job-timeout-minutes"]?.default, 15);
  assert.equal(workflow.on.workflow_call.inputs["runtime-binding-timeout-minutes"]?.type, "number");
  assert.equal(workflow.on.workflow_call.inputs["runtime-binding-timeout-minutes"]?.default, 10);
  assert.notEqual(workflow.on.workflow_call.inputs["invocation-path"]?.required, true);
  assert.notEqual(workflow.on.workflow_call.inputs.workflow?.required, true);
  assert.deepEqual(
    Object.keys(workflow.on.workflow_call.outputs).sort(),
    ["failure-category", "http-status", "outcome", "runtime-uid", "status", "task-uid"],
  );

  const job = workflow.jobs.governed;
  assert.equal(job?.outputs?.outcome, "${{ steps.task.outputs.outcome }}");
  assert.equal(job?.outputs?.["failure-category"], "${{ steps.task.outputs.failure-category }}");
  assert.equal(job?.outputs?.["http-status"], "${{ steps.task.outputs.http-status }}");
  assert.equal(job?.permissions?.contents, "read");
  assert.equal(job?.permissions?.["id-token"], "write");
  assert.equal(job?.["runs-on"], "${{ inputs.runner-label }}");
  assert.equal(job?.["timeout-minutes"], "${{ inputs.job-timeout-minutes }}");
  const containerImage = job?.container?.image ?? "";
  assert.equal(containerImage, governedJobContainer);
  assert.equal(job?.container?.credentials, undefined);
  assert.match(
    containerImage,
    /^ghcr\.io\/apelogic-ai\/steward-run@sha256:[a-f0-9]{64}$/u,
  );
  assert.doesNotMatch(containerImage, /\$\{\{/u);
  assert.doesNotMatch(containerImage.split("@", 1)[0] ?? "", /:[^/]+$/u);
  assert.equal(workflow.on.workflow_call.inputs["container-image"], undefined);
  assert.equal(workflow.on.workflow_call.inputs["job-container-image"], undefined);
  assert.match(source, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u);
  assert.match(source, /if:\s*inputs\.invocation-path != ''/u);
  assert.match(source, /ref:\s*\$\{\{ github\.sha \}\}/u);
  assert.match(source, /persist-credentials:\s*false/u);
  assert.doesNotMatch(source, /inputs\.action-commit/u);
  assert.match(source, /repository:\s*\$\{\{ job\.workflow_repository \}\}/u);
  assert.match(source, /ref:\s*\$\{\{ job\.workflow_sha \}\}/u);
  assert.match(source, /path:\s*\.steward-run-action/u);
  assert.match(source, /actions\/download-artifact@/);
  assert.match(source, /name:\s*\$\{\{ inputs\.input-artifact \}\}/);
  assert.match(source, /path:\s*in/);
  assert.match(source, /uses:\s*\.\/\.steward-run-action/u);
  assert.doesNotMatch(source, /uses:\s*apelogic-ai\/steward-run@/u);
  assert.match(source, /identity-exchange-url:\s*\$\{\{ inputs\.identity-exchange-url \}\}/);
  assert.match(
    source,
    /identity-exchange-audience:\s*\$\{\{ inputs\.identity-exchange-audience \}\}/u,
  );
  assert.match(source, /inputs:\s*in/);
  assert.match(source, /outputs:\s*out/);
  assert.match(source, /invocation-path:\s*\$\{\{ inputs\.invocation-path \}\}/u);
  assert.match(source, /workflow:\s*\$\{\{ inputs\.workflow \}\}/u);
  assert.match(source, /runtime-binding-timeout-minutes:\s*\$\{\{ inputs\.runtime-binding-timeout-minutes \}\}/u);
  assert.doesNotMatch(source, /coding-agent-runtime|codingAgentRuntime/u);
  assert.match(source, /actions\/upload-artifact@/);
  assert.match(source, /name:\s*\$\{\{ inputs\.output-artifact \}\}/);
  assert.match(source, /path:\s*out/);
  assert.doesNotMatch(source, /oidc-audience|bearer-token|identity\.dev|cluster|secret/iu);

  const checkout = source.indexOf("path: .steward-run-action");
  const download = source.indexOf("actions/download-artifact@");
  const action = source.indexOf("uses: ./.steward-run-action");
  const upload = source.indexOf("actions/upload-artifact@");
  assert.ok(checkout >= 0 && checkout < download && download < action && action < upload);
});

test("the self-hosted reusable workflow preserves GitHub OIDC provenance without a job container", async () => {
  const source = await readFile(
    new URL("../.github/workflows/steward-task-self-hosted.yml", import.meta.url),
    "utf8",
  );
  const workflow = parse(source) as {
    on: {
      workflow_call: {
        inputs: Record<string, { required?: boolean; default?: string | number; type?: string }>;
        outputs: Record<string, unknown>;
      };
    };
    jobs: Record<string, { container?: unknown; permissions?: Record<string, string>; "runs-on"?: string; "timeout-minutes"?: string; outputs?: Record<string, string> }>;
  };

  assert.ok(workflow.on.workflow_call);
  assert.deepEqual(
    Object.keys(workflow.on.workflow_call.outputs).sort(),
    ["failure-category", "http-status", "outcome", "runtime-uid", "status", "task-uid"],
  );
  assert.equal(workflow.jobs.governed?.outputs?.outcome, "${{ steps.task.outputs.outcome }}");
  assert.equal(workflow.jobs.governed?.outputs?.["failure-category"], "${{ steps.task.outputs.failure-category }}");
  assert.equal(workflow.jobs.governed?.outputs?.["http-status"], "${{ steps.task.outputs.http-status }}");
  assert.equal(workflow.jobs.governed?.["runs-on"], "${{ inputs.runner-label }}");
  assert.equal(workflow.jobs.governed?.["timeout-minutes"], "${{ inputs.job-timeout-minutes }}");
  assert.equal(workflow.on.workflow_call.inputs["job-timeout-minutes"]?.default, 15);
  assert.equal(workflow.on.workflow_call.inputs["runtime-binding-timeout-minutes"]?.default, 10);
  assert.equal(workflow.jobs.governed?.permissions?.contents, "read");
  assert.equal(workflow.jobs.governed?.permissions?.["id-token"], "write");
  assert.equal(workflow.jobs.governed?.container, undefined);
  for (const name of [
    "identity-exchange-url",
    "identity-exchange-audience",
    "steward-ca-certificate-file",
  ]) {
    assert.notEqual(workflow.on.workflow_call.inputs[name]?.required, true, name);
    assert.equal((workflow.on.workflow_call.inputs[name] as { default?: string })?.default, "", name);
  }
  assert.notEqual(workflow.on.workflow_call.inputs["invocation-path"]?.required, true);
  assert.notEqual(workflow.on.workflow_call.inputs.workflow?.required, true);
  assert.match(source, /repository:\s*\$\{\{ job\.workflow_repository \}\}/u);
  assert.match(source, /ref:\s*\$\{\{ job\.workflow_sha \}\}/u);
  assert.match(source, /uses:\s*\.\/\.steward-run-action/u);
  assert.doesNotMatch(source, /uses:\s*apelogic-ai\/steward-run@/u);
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
  assert.match(source, /runtime-binding-timeout-minutes:\s*\$\{\{ inputs\.runtime-binding-timeout-minutes \}\}/u);
  assert.doesNotMatch(source, /amazonaws\.com|container:|bearer-token|identity\.dev|cluster|secret/iu);
});

test("CI executes the governed job-container runtime contract", async () => {
  const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

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
});

test("portable OSS release publishes verified attestations, signatures, checksums, and preflight", async () => {
  const release = await readFile(
    new URL("../.github/workflows/portable-release.yml", import.meta.url),
    "utf8",
  );
  assert.match(release, /provenance: mode=max,builder-id=\$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}\/actions\/runs\/\$\{\{ github\.run_id \}\}/u);
  assert.match(release, /sbom: generator=docker\.io\/docker\/buildkit-syft-scanner@sha256:[a-f0-9]{64}/u);
  const sbomGeneratorDigests = [...release.matchAll(/sbom: generator=docker\.io\/docker\/buildkit-syft-scanner@sha256:([a-f0-9]+)/gu)];
  assert.equal(sbomGeneratorDigests.length, 4);
  for (const [, digest] of sbomGeneratorDigests) assert.equal(digest?.length, 64);
  assert.match(release, /verify-release-attestations\.mjs/u);
  assert.match(
    release,
    /verify-release-attestations\.mjs[\s\\\n]+"\$RUNNER_TEMP\/image-index\.json"/u,
  );
  assert.match(release, /resume_image_digest:/u);
  assert.match(release, /resume_chart_digest:/u);
  assert.match(release, /operation:[\s\S]*?- release[\s\S]*?- bootstrap/u);
  assert.match(release, /bootstrap-preflight:/u);
  assert.match(release, /bootstrap-build-amd64:/u);
  assert.match(release, /bootstrap-build-arm64:/u);
  assert.match(release, /bootstrap-publish:/u);
  assert.match(release, /printf 'tag=bootstrap-%s-%s/u);
  assert.match(release, /Verify patched amd64 bootstrap image[\s\S]*?3\.0\.13-0ubuntu3\.15/u);
  assert.match(release, /Verify patched arm64 bootstrap image[\s\S]*?3\.0\.13-0ubuntu3\.15/u);
  assert.match(release, /verify-runnable-image-platforms\.mjs[\s\\\n]*"\$RUNNER_TEMP\/bootstrap-index\.json" linux\/amd64 linux\/arm64/u);
  assert.match(release, /push:[\s\S]*?tags:[\s\S]*?v\[0-9\]\+/u);
  assert.match(release, /refs\/tags\/v\[0-9\]\+/u);
  assert.doesNotMatch(release, /\[\[ "\$GITHUB_REF" == refs\/heads\/main \]\]/u);
  assert.match(release, /default_branch=.*\.default_branch/u);
  assert.match(release, /compare\/\$GITHUB_SHA\.\.\.refs\/heads\/\$default_branch/u);
  assert.match(release, /"\$main_status" == "identical"[\s\S]*?"\$main_status" == "ahead"/u);
  assert.match(release, /identity="https:\/\/github\.com\/\$GITHUB_REPOSITORY\/\.github\/workflows\/portable-release\.yml@\$GITHUB_REF"/u);
  assert.equal(
    release.match(/VERSION=\$\{\{ needs\.preflight\.outputs\.version \}\}/gu)?.length,
    2,
  );
  assert.match(release, /helm pull "oci:\/\/\$CHART"/u);
  assert.match(release, /"\$image_digest" == "\$RESUME_IMAGE_DIGEST"/u);
  assert.match(release, /"\$chart_digest" == "\$RESUME_CHART_DIGEST"/u);
  assert.match(release, /release-attestation-summary\.json/u);
  assert.match(release, /cosign sign --yes[\s\S]*?\$IMAGE@\$IMAGE_DIGEST/u);
  assert.match(release, /cosign sign --yes[\s\S]*?\$CHART@\$CHART_DIGEST/u);
  assert.match(release, /COSIGN_EXPERIMENTAL: "1"/u);
  assert.match(release, /SHA256SUMS/u);
  assert.match(release, /steward-run-arc-preflight\.mjs/u);
  assert.match(release, /arc-controller-identity\.mjs/u);
  assert.match(release, /artifacthub-repo\.yml:application\/vnd\.cncf\.artifacthub\.repository-metadata\.layer\.v1\.yaml/u);
  assert.match(release, /oras manifest fetch --descriptor "\$CHART:artifacthub\.io"/u);
  assert.doesNotMatch(release, /ACTION_COMMIT/u);
  assert.match(release, /action_metadata="\$\(cat action\.yml\)"/u);
  assert.match(release, /grep -Fq "failure-category:" <<<"\$action_metadata"/u);
  assert.match(release, /grep -Fq "actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020" <<<"\$action_metadata"/u);
  assert.match(release, /grep -Fq "if: steps\.node24\.outputs\.available != 'true'" <<<"\$action_metadata"/u);
  assert.match(release, /grep -Fq "package-manager-cache: false" <<<"\$action_metadata"/u);
  assert.match(release, /RELEASE_IDENTITY=.*refs\/tags\/\$RELEASE_TAG/u);
  assert.match(release, /grep -Fq "failure-category:" \.github\/workflows\/steward-task\.yml/u);
  assert.match(release, /grep -Fq "failure-category:" \.github\/workflows\/steward-task-self-hosted\.yml/u);
  assert.match(release, /job_container_image=[\s\S]*?steward-task\.yml/u);
  assert.match(release, /job_container_image.*\^ghcr\\\.io\/\$owner\/steward-run@sha256/u);
  assert.match(release, /github\.com\/apelogic-ai\/steward-run[\s\S]*?artifacthub-repo\.yml/u);
  const vendoredChartCheck = release.indexOf("npm run check:vendored-chart");
  const chartPackage = release.indexOf("helm package charts/steward-run-arc");
  assert.ok(vendoredChartCheck >= 0 && vendoredChartCheck < chartPackage);
  assert.match(release, /schemaVersion:3/u);
  assert.match(release, /workflowRepository:\$workflow_repository/u);
  assert.match(release, /workflowCommit:\$workflow_commit/u);
  assert.match(release, /actionCommit:\$action_commit/u);
  assert.match(release, /--arg action_commit "\$GITHUB_SHA"/u);
  assert.match(release, /image:\$image/u);
  assert.doesNotMatch(release, /governedJobContainerImage/u);
  assert.match(release, /format:"buildkit-embedded-oci"/u);
  assert.match(release, /githubArtifactAttestations:false/u);
  assert.match(release, /embedded OCI attestations, not[\s\S]*?GitHub artifact attestations/u);
  assert.match(release, /docs\/release-notes-v\$VERSION\.md/u);
  assert.match(release, /cp "docs\/release-notes-v\$VERSION\.md" "\$RUNNER_TEMP\/release-notes\.md"/u);
  assert.match(release, /check-public-release-assets\.mjs/u);
  assert.match(release, /public-release-assets/u);
  assert.doesNotMatch(
    release,
    /aws-actions\/configure-aws-credentials|AWS_ROLE_ARN|ECR_REGISTRY|ECR_REPOSITORY|aws ecr/iu,
  );
  assert.doesNotMatch(release, /provenance: false|sbom: false/u);
  assert.doesNotMatch(release, /helm dependency build/u);
  assert.match(release, /DOCKER_BUILD_RECORD_UPLOAD:\s*"false"/u);
  assert.match(release, /STEWARD_RUN_RELEASE_AMD64_RUNNER/u);
  assert.match(release, /STEWARD_RUN_RELEASE_ARM64_RUNNER/u);
});

test("mock OIDC routing is isolated from production workflows", async () => {
  const productionSources = await Promise.all(
    ["../action.yml", "../.github/workflows/ci.yml", "../.github/workflows/portable-release.yml", "../.github/workflows/steward-task.yml"].map(
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
    new URL("../.github/workflows/portable-release.yml", import.meta.url),
    "utf8",
  );
  const productionHandoffs = `${readme}\n${specification}\n${releaseWorkflow}`;

  assert.doesNotMatch(productionHandoffs, /steward-task\.yml@main/u);
  assert.match(readme, /docs\/installation-v0\.5\.0\.md/u);
  assert.doesNotMatch(readme, /uses:\s*apelogic-ai\/steward-run\/\.github\/workflows\/steward-task\.yml/u);
  assert.doesNotMatch(readme, /action-commit:/u);
  assert.doesNotMatch(releaseWorkflow, /ACTION_COMMIT/u);
  for (const workflow of ["steward-task.yml", "steward-task-self-hosted.yml"]) {
    assert.ok(
      releaseWorkflow.includes(
        `grep -Fq 'uses: ./.steward-run-action' ".github/workflows/$workflow"`,
      ),
    );
  }
  assert.match(releaseWorkflow, /workflowCommit:\$workflow_commit/u);
  assert.match(releaseWorkflow, /actionCommit:\$action_commit/u);
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
