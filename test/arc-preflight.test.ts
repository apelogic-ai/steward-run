import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveControllerIdentity } from "../scripts/arc-controller-identity.mjs";
import {
  evaluateControllerState,
  evaluateRunnerLinkage,
  PreflightError,
} from "../scripts/steward-run-arc-preflight.mjs";

const identity = resolveControllerIdentity({ namespace: "arc-system", releaseName: "arc" });
const root = new URL("..", import.meta.url).pathname;

function state(version = "0.14.2") {
  return {
    namespace: { metadata: { name: "arc-system" } },
    deployment: {
      metadata: {
        annotations: {
          "meta.helm.sh/release-name": "arc",
          "meta.helm.sh/release-namespace": "arc-system",
        },
        labels: {
          "app.kubernetes.io/instance": "arc",
          "app.kubernetes.io/part-of": "gha-rs-controller",
          "helm.sh/chart": `gha-rs-controller-${version}`,
          "actions.github.com/controller-service-account-name": "arc-gha-rs-controller",
          "actions.github.com/controller-service-account-namespace": "arc-system",
        },
      },
      spec: {
        template: {
          metadata: { labels: { "app.kubernetes.io/version": version } },
          spec: { serviceAccountName: "arc-gha-rs-controller" },
        },
      },
    },
    serviceAccount: { metadata: { name: "arc-gha-rs-controller", namespace: "arc-system" } },
  };
}

function expectCode(fn: () => void, code: string) {
  assert.throws(fn, (error: unknown) => error instanceof PreflightError && error.code === code);
}

test("accepts the pinned controller and exact scale-set linkage", () => {
  const fixture = state();
  evaluateControllerState(fixture.namespace, fixture.deployment, fixture.serviceAccount, identity);
  evaluateRunnerLinkage(
    { items: [{ subjects: [{ kind: "ServiceAccount", namespace: "arc-system", name: "arc-gha-rs-controller" }] }] },
    identity,
    "arc-runners",
    "steward-run",
  );
});

test("classifies incompatible ARC and identity mismatches", () => {
  const incompatible = state("0.13.0");
  expectCode(
    () => evaluateControllerState(incompatible.namespace, incompatible.deployment, incompatible.serviceAccount, identity),
    "arc-version-incompatible",
  );
  const wrongRelease = state();
  wrongRelease.deployment.metadata.annotations["meta.helm.sh/release-name"] = "other";
  expectCode(
    () => evaluateControllerState(wrongRelease.namespace, wrongRelease.deployment, wrongRelease.serviceAccount, identity),
    "controller-release-mismatch",
  );
  const wrongServiceAccount = state();
  wrongServiceAccount.deployment.spec.template.spec.serviceAccountName = "other";
  expectCode(
    () => evaluateControllerState(wrongServiceAccount.namespace, wrongServiceAccount.deployment, wrongServiceAccount.serviceAccount, identity),
    "controller-service-account-mismatch",
  );
});

test("classifies missing and incorrect scale-set linkage", () => {
  expectCode(
    () => evaluateRunnerLinkage({ items: [] }, identity, "arc-runners", "steward-run"),
    "runner-linkage-missing",
  );
  expectCode(
    () => evaluateRunnerLinkage(
      { items: [{ subjects: [{ kind: "ServiceAccount", namespace: "arc-system", name: "other" }] }] },
      identity,
      "arc-runners",
      "steward-run",
    ),
    "runner-linkage-mismatch",
  );
});

test("CLI returns stable JSON codes for missing live objects and incompatible ARC", () => {
  const work = mkdtempSync(join(tmpdir(), "steward-run-preflight-"));
  const fakeKubectl = join(work, "kubectl");
  const fixture = state();
  writeFileSync(
    fakeKubectl,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const scenario = process.env.FAKE_SCENARIO;
const kind = args[args.indexOf("get") + 1];
if ((kind === "namespace" && scenario === "missing-namespace") ||
    (kind === "deployment" && scenario === "missing-deployment") ||
    (kind === "serviceaccount" && scenario === "missing-service-account")) process.exit(1);
const objects = ${JSON.stringify(fixture)};
if (scenario === "incompatible-version") {
  objects.deployment.metadata.labels["helm.sh/chart"] = "gha-rs-controller-0.13.0";
  objects.deployment.spec.template.metadata.labels["app.kubernetes.io/version"] = "0.13.0";
}
process.stdout.write(JSON.stringify(kind === "namespace" ? objects.namespace : kind === "deployment" ? objects.deployment : objects.serviceAccount));
`,
    "utf8",
  );
  chmodSync(fakeKubectl, 0o755);
  try {
    const scenarios = new Map([
      ["missing-namespace", "controller-namespace-not-found"],
      ["missing-deployment", "controller-deployment-not-found"],
      ["missing-service-account", "controller-service-account-not-found"],
      ["incompatible-version", "arc-version-incompatible"],
    ]);
    for (const [scenario, expectedCode] of scenarios) {
      const result = spawnSync(
        "node",
        [
          "scripts/steward-run-arc-preflight.mjs",
          "--namespace",
          "arc-system",
          "--release-name",
          "arc",
          "--output",
          "json",
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, PATH: `${work}:${process.env.PATH}`, FAKE_SCENARIO: scenario },
        },
      );
      assert.equal(result.status, 1, scenario);
      assert.deepEqual(JSON.parse(result.stdout), {
        status: "error",
        code: expectedCode,
        message: JSON.parse(result.stdout).message,
      });
      assert.equal(result.stderr, "");
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
