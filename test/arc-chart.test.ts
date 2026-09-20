import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseAllDocuments } from "yaml";

const root = new URL("..", import.meta.url).pathname;
const chartSource = join(root, "charts", "steward-run-arc");
const fixture = join(root, "test", "fixtures", "arc-values.yaml");

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
    helm("dependency", "build", chart);
    helm("lint", chart, "--strict", "--values", fixture);
    const rendered = helm("template", "steward-run", chart, "--namespace", "arc-runners", "--values", fixture);
    const objects = parseAllDocuments(rendered).map((doc) => doc.toJSON()).filter(Boolean) as Record<string, any>[];
    const scaleSet = objects.find((object) => object.kind === "AutoscalingRunnerSet");
    assert.ok(scaleSet, "must render a real upstream ARC scale set");
    assert.equal(scaleSet.spec.githubConfigUrl, "https://github.com/customer/example");
    assert.equal(scaleSet.spec.githubConfigSecret, "steward-run-github-app");
    assert.equal(scaleSet.spec.minRunners, 0);
    assert.equal(scaleSet.spec.maxRunners, 5);
    assert.deepEqual(scaleSet.spec.runnerScaleSetLabels, ["steward-run"]);
    const pod = scaleSet.spec.template.spec;
    assert.equal(pod.containers[0].name, "runner");
    assert.match(pod.containers[0].image, /^registry\.example\/steward-run@sha256:[a-f0-9]{64}$/u);
    assert.equal(pod.containers[0].securityContext.allowPrivilegeEscalation, false);
    assert.deepEqual(pod.imagePullSecrets, [{ name: "customer-registry" }]);
    assert.ok(objects.some((object) => object.kind === "ServiceAccount"));
    assert.ok(objects.some((object) => object.kind === "Role"));
    assert.ok(!objects.some((object) => object.kind === "Deployment" || object.kind === "CustomResourceDefinition"));
    assert.ok(!objects.some((object) => object.kind === "Secret" && object.data?.github_app_private_key));
    assert.throws(() => helm("template", "steward-run", chart, "--namespace", "arc-runners"), /githubConfigUrl|image|githubConfigSecret/u);
    assert.throws(
      () => helm("template", "steward-run", chart, "--namespace", "arc-runners", "--values", fixture, "--set", "gha-runner-scale-set.template.spec.containers[0].image=registry.example/steward-run:latest"),
      /sha256|digest/u,
    );
    const metadata = readFileSync(join(chart, "Chart.yaml"), "utf8");
    assert.match(metadata, /type: application/u);
    assert.match(metadata, /version: 0\.14\.2/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
