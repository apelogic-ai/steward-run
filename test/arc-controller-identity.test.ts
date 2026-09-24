import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  deriveControllerName,
  resolveControllerIdentity,
  supportedArcVersion,
} from "../scripts/arc-controller-identity.mjs";

const root = new URL("..", import.meta.url).pathname;

test("derives the pinned ARC 0.14.2 controller identity from its Helm release", () => {
  assert.equal(supportedArcVersion, "0.14.2");
  assert.equal(deriveControllerName("arc"), "arc-gha-rs-controller");
  assert.equal(deriveControllerName("customer-gha-rs-controller"), "customer-gha-rs-controller");
  assert.equal(deriveControllerName("a".repeat(53)), `${"a".repeat(53)}-gha-rs-co`);
  assert.deepEqual(
    resolveControllerIdentity({ namespace: "arc-system", releaseName: "arc" }),
    {
      arcVersion: "0.14.2",
      namespace: "arc-system",
      releaseName: "arc",
      deploymentName: "arc-gha-rs-controller",
      serviceAccountName: "arc-gha-rs-controller",
      serviceAccountDerived: true,
    },
  );
});

test("uses an explicit controller ServiceAccount override", () => {
  const identity = resolveControllerIdentity({
    namespace: "controllers",
    releaseName: "customer-arc",
    serviceAccountName: "customer-controller-sa",
  });
  assert.equal(identity.deploymentName, "customer-arc-gha-rs-controller");
  assert.equal(identity.serviceAccountName, "customer-controller-sa");
  assert.equal(identity.serviceAccountDerived, false);
});

test("CLI emits the exact application-chart values and rejects incomplete identity", () => {
  const values = execFileSync(
    "node",
    [
      "scripts/arc-controller-identity.mjs",
      "--namespace",
      "arc-system",
      "--release-name",
      "arc",
      "--output",
      "values",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(
    values,
    "gha-runner-scale-set:\n  controllerServiceAccount:\n    namespace: arc-system\n    name: arc-gha-rs-controller\n",
  );
  assert.throws(
    () => execFileSync("node", ["scripts/arc-controller-identity.mjs", "--namespace", "arc-system"], { cwd: root, encoding: "utf8" }),
    /--release-name is required/u,
  );
});
