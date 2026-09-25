import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseAllDocuments } from "yaml";
import { resolveControllerIdentity } from "../scripts/arc-controller-identity.mjs";

const root = new URL("..", import.meta.url).pathname;
const chartSource = join(root, "charts", "steward-run-arc");
const fixture = join(root, "test", "fixtures", "arc-values.yaml");
const caFixture = join(root, "test", "fixtures", "arc-ca-values.yaml");

test("customer chart installs a digest-pinned ARC scale set without owning the controller", () => {
  const work = mkdtempSync(join(tmpdir(), "steward-run-arc-test-"));
  const chart = join(work, "chart");
  try {
    cpSync(chartSource, chart, { recursive: true });
    const env = {
      ...process.env,
      HELM_CACHE_HOME: join(work, "cache"),
      HELM_CONFIG_HOME: join(work, "config"),
    };
    const helm = (...args: string[]) => execFileSync("helm", args, { encoding: "utf8", env });
    const template = (...args: string[]) => helm("template", ...args, "--kube-version", "1.34.0");
    helm("dependency", "build", chart);
    helm("lint", chart, "--strict", "--values", fixture);
    const rendered = template("steward-run", chart, "--namespace", "arc-runners", "--values", fixture);
    for (const version of ["1.30.0", "1.34.0"]) {
      assert.match(helm("template", "steward-run", chart, "--namespace", "arc-runners", "--values", fixture, "--kube-version", version), /kind: AutoscalingRunnerSet/u);
    }
    const objects = parseAllDocuments(rendered).map((doc) => doc.toJSON()).filter(Boolean) as Record<string, any>[];
    const scaleSet = objects.find((object) => object.kind === "AutoscalingRunnerSet");
    assert.ok(scaleSet, "must render a real upstream ARC scale set");
    assert.equal(scaleSet.spec.githubConfigUrl, "https://github.com/customer/example");
    assert.equal(scaleSet.spec.githubConfigSecret, "steward-run-github-app");
    assert.equal(scaleSet.spec.minRunners, 0);
    assert.equal(scaleSet.spec.maxRunners, 5);
    assert.equal(scaleSet.spec.containerMode?.type, undefined);
    assert.deepEqual(scaleSet.spec.runnerScaleSetLabels, ["steward-run"]);
    const managerBinding = objects.find((object) => object.kind === "RoleBinding" && object.metadata?.name === "steward-run-gha-rs-manager");
    const derivedController = resolveControllerIdentity({ namespace: "arc-system", releaseName: "arc" });
    assert.deepEqual(managerBinding?.subjects, [{
      kind: "ServiceAccount",
      name: derivedController.serviceAccountName,
      namespace: derivedController.namespace,
    }]);
    const pod = scaleSet.spec.template.spec;
    assert.equal(pod.containers[0].name, "runner");
    assert.equal(pod.nodeSelector, undefined);
    assert.equal(pod.affinity, undefined);
    assert.equal(pod.automountServiceAccountToken, false);
    assert.match(pod.containers[0].image, /^registry\.example\/steward-run@sha256:[a-f0-9]{64}$/u);
    assert.equal(pod.containers[0].securityContext.allowPrivilegeEscalation, false);
    assert.deepEqual(pod.imagePullSecrets, [{ name: "customer-registry" }]);
    const caRendered = template("steward-run", chart, "--namespace", "arc-runners", "--values", caFixture);
    const caObjects = parseAllDocuments(caRendered).map((doc) => doc.toJSON()).filter(Boolean) as Record<string, any>[];
    const caPod = caObjects.find((object) => object.kind === "AutoscalingRunnerSet")?.spec.template.spec;
    assert.deepEqual(caPod.volumes.find((volume: any) => volume.name === "steward-run-trust-bundle")?.configMap, {
      name: "steward-run-ca",
      items: [{ key: "ca.crt", path: "ca.crt" }],
    });
    assert.deepEqual(caPod.containers[0].volumeMounts, [{ name: "steward-run-trust-bundle", mountPath: "/etc/steward-run/trust", readOnly: true }]);
    assert.deepEqual(caPod.containers[0].env, [{ name: "NODE_EXTRA_CA_CERTS", value: "/etc/steward-run/trust/ca.crt" }]);
    assert.equal(pod.volumes, undefined);
    assert.equal(pod.containers[0].env, undefined);
    assert.ok(objects.some((object) => object.kind === "ServiceAccount"));
    assert.ok(objects.some((object) => object.kind === "Role"));
    assert.ok(!objects.some((object) => object.kind === "Deployment" || object.kind === "CustomResourceDefinition"));
    assert.ok(!objects.some((object) => object.kind === "Secret" && object.data?.github_app_private_key));
    assert.throws(() => template("steward-run", chart, "--namespace", "arc-runners"), /githubConfigUrl|image|githubConfigSecret/u);
    assert.throws(
      () => template("steward-run", chart, "--namespace", "arc-runners", "--values", fixture, "--set", "gha-runner-scale-set.template.spec.containers[0].image=registry.example/steward-run:latest"),
      /sha256|digest/u,
    );
    assert.throws(
      () => template("steward-run", chart, "--namespace", "arc-runners", "--values", fixture, "--set", `gha-runner-scale-set.template.spec.containers[0].image=registry.example/steward-run@sha256:${"0".repeat(64)}`),
      /gha-runner-scale-set\.template\.spec\.containers\[0\]\.image|Must not validate/u,
    );
    assert.throws(
      () => template("steward-run", chart, "--namespace", "arc-runners", "--values", fixture, "--skip-schema-validation", "--set", `gha-runner-scale-set.template.spec.containers[0].image=registry.example/steward-run@sha256:${"0".repeat(64)}`),
      /gha-runner-scale-set\.template\.spec\.containers\[0\]\.image must be a released immutable digest/u,
    );
    assert.throws(
      () => template("steward-run", chart, "--namespace", "arc-runners", "--values", fixture, "--set", "gha-runner-scale-set.githubConfigUrl=https://git.example.com/customer/example"),
      /githubConfigUrl/u,
    );
    assert.throws(
      () => template("steward-run", chart, "--namespace", "arc-runners", "--values", fixture, "--set", "gha-runner-scale-set.controllerServiceAccount.name="),
      /controllerServiceAccount\.name/u,
    );
    assert.throws(
      () => template("steward-run", chart, "--namespace", "arc-runners", "--values", caFixture, "--set", "gha-runner-scale-set.template.spec.volumes[0].configMap.name="),
      /configMap\.name|valid non-empty ConfigMap name/u,
    );
    assert.throws(
      () => template("steward-run", chart, "--namespace", "arc-runners", "--values", caFixture, "--set", "gha-runner-scale-set.template.spec.containers[0].env=null"),
      /containers\.0\.env|requires exactly one ConfigMap volume, runner mount, and NODE_EXTRA_CA_CERTS entry/u,
    );
    const overridden = template(
      "steward-run",
      chart,
      "--namespace",
      "arc-runners",
      "--values",
      fixture,
      "--set",
      "gha-runner-scale-set.controllerServiceAccount.namespace=customer-controllers",
      "--set",
      "gha-runner-scale-set.controllerServiceAccount.name=customer-controller-sa",
    );
    const overrideBinding = parseAllDocuments(overridden)
      .map((doc) => doc.toJSON())
      .filter(Boolean)
      .find((object: any) => object.kind === "RoleBinding" && object.metadata?.name === "steward-run-gha-rs-manager");
    assert.deepEqual(overrideBinding?.subjects, [{
      kind: "ServiceAccount",
      name: "customer-controller-sa",
      namespace: "customer-controllers",
    }]);
    const metadata = readFileSync(join(chart, "Chart.yaml"), "utf8");
    const schema = readFileSync(join(chart, "values.schema.json"), "utf8");
    assert.match(metadata, /type: application/u);
    assert.match(metadata, /version: 0\.14\.2/u);
    assert.doesNotMatch(metadata, /apelogic-ai\/steward-run/u);
    for (const field of ["configMap", "items", "env", "volumeMounts", "mountPath", "readOnly"]) {
      assert.ok(schema.includes(`\"${field}\"`), `trust-bundle schema: ${field}`);
    }

    const upstreamValues = execFileSync("tar", ["-xOf", join(chart, "charts", "gha-runner-scale-set-0.14.2.tgz"), "gha-runner-scale-set/values.yaml"], { encoding: "utf8" });
    for (const key of ["github_app_id", "github_app_installation_id", "github_app_private_key", "githubConfigSecret", "imagePullSecrets"]) {
      assert.ok(upstreamValues.includes(key) || (key === "imagePullSecrets" && upstreamValues.includes("template:")), `upstream ARC contract: ${key}`);
    }
    const guide = readFileSync(join(root, "docs", "installation.md"), "utf8");
    const action = readFileSync(join(root, "action.yml"), "utf8");
    for (const key of ["ConfigMap", "NODE_EXTRA_CA_CERTS", "ca.crt"]) {
      assert.ok(guide.includes(key), `inventory: ${key}`);
    }
    assert.match(action, /identity-exchange-url/u);
    assert.match(action, /identity-exchange-audience/u);
    assert.match(guide, /id-token: write/u);

    const kubeconfig = join(work, "kubeconfig");
    writeFileSync(kubeconfig, "apiVersion: v1\nkind: Config\nclusters:\n- name: fixture\n  cluster:\n    server: https://127.0.0.1:1\ncontexts:\n- name: fixture\n  context:\n    cluster: fixture\n    user: fixture\ncurrent-context: fixture\nusers:\n- name: fixture\n  user:\n    token: local-dry-run-fixture\n", { mode: 0o600 });
    const appId = join(work, "app-id.txt");
    const installationId = join(work, "installation-id.txt");
    const privateKey = join(work, "app.pem");
    writeFileSync(appId, "123456\n", { mode: 0o600 });
    writeFileSync(installationId, "654321\n", { mode: 0o600 });
    writeFileSync(privateKey, "test-key-version-one\n", { mode: 0o600 });
    const kubectl = (...args: string[]) => JSON.parse(execFileSync("kubectl", ["--kubeconfig", kubeconfig, "--context", "fixture", "-n", "arc-runners", ...args, "--dry-run=client", "-o=json"], { encoding: "utf8" })) as Record<string, any>;
    const appArgs = ["create", "secret", "generic", "steward-run-github-app", `--from-file=github_app_id=${appId}`, `--from-file=github_app_installation_id=${installationId}`, `--from-file=github_app_private_key=${privateKey}`];
    const createdApp = kubectl(...appArgs);
    assert.deepEqual(Object.keys(createdApp.data).sort(), ["github_app_id", "github_app_installation_id", "github_app_private_key"].sort());
    assert.equal(createdApp.kind, "Secret");
    assert.equal(createdApp.type ?? "Opaque", "Opaque");
    writeFileSync(privateKey, "test-key-version-two\n", { mode: 0o600 });
    const rotatedApp = kubectl(...appArgs);
    assert.notEqual(createdApp.data.github_app_private_key, rotatedApp.data.github_app_private_key);
    const ca = join(work, "ca.crt");
    writeFileSync(ca, "test-ca-version-one\n", { mode: 0o600 });
    const caArgs = ["create", "configmap", "steward-run-ca", `--from-file=ca.crt=${ca}`];
    const createdCa = kubectl(...caArgs);
    assert.deepEqual(Object.keys(createdCa.data), ["ca.crt"]);
    writeFileSync(ca, "test-ca-version-two\n", { mode: 0o600 });
    assert.notEqual(createdCa.data["ca.crt"], kubectl(...caArgs).data["ca.crt"]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
