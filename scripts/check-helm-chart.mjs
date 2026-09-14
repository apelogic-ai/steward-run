import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";

const root = new URL("..", import.meta.url).pathname;
const chart = join(root, "charts", "steward-run");
const fixture = join(chart, "testdata", "consumer");
const generatedCharts = join(fixture, "charts");
const generatedLock = join(fixture, "Chart.lock");
const values = join(fixture, "values.yaml");
const helmHome = mkdtempSync(join(tmpdir(), "steward-run-helm-"));
const helmRepositoryCache = join(helmHome, "repository");
mkdirSync(helmRepositoryCache);

function helm(...args) {
  return execFileSync("helm", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HELM_REPOSITORY_CONFIG: join(helmHome, "repositories.yaml"),
      HELM_REPOSITORY_CACHE: helmRepositoryCache,
    },
  });
}

try {
  helm("lint", chart);
  helm("dependency", "build", fixture);
  const output = helm("template", "steward-run-render-test", fixture, "--values", values);
  const documents = parseAllDocuments(output)
    .map((document) => document.toJSON())
    .filter((document) => document !== null);

  assert.equal(documents.length, 1, "the render fixture must produce only a Pod fragment consumer");
  const pod = documents[0];
  assert.equal(pod.apiVersion, "v1");
  assert.equal(pod.kind, "Pod");
  assert.equal(pod.spec.containers.length, 1);
  assert.deepEqual(pod.spec.containers[0], {
    name: "runner",
    image: "registry.example.com/apelogic/steward-run@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    imagePullPolicy: "IfNotPresent",
    command: ["/home/runner/run.sh"],
    securityContext: {
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
      privileged: false,
      readOnlyRootFilesystem: false,
    },
    resources: {
      requests: { cpu: "250m", memory: "512Mi" },
      limits: { cpu: "1", memory: "1Gi" },
    },
  });
  assert.deepEqual(pod.spec.imagePullSecrets, [{ name: "existing-registry-pull-secret" }]);
  assert.deepEqual(pod.spec.securityContext, {
    runAsNonRoot: true,
    runAsUser: 1001,
    runAsGroup: 1001,
    fsGroup: 1001,
    fsGroupChangePolicy: "OnRootMismatch",
    seccompProfile: { type: "RuntimeDefault" },
  });
  assert.equal(pod.spec.serviceAccountName, undefined);
  assert.equal(pod.spec.containers[0].env, undefined);
  assert.throws(
    () => helm("template", "steward-run-render-test", fixture, "--values", values, "--set", "steward-run.image.digest="),
    /steward-run\.image\.digest must be an exact lowercase sha256 OCI digest/,
    "a consumer must not render a mutable or empty runner image reference",
  );

  const chartReadme = readFileSync(join(chart, "README.md"), "utf8");
  assert.match(chartReadme, /no `Deployment`, `Service`, `Job`, `CronJob`, or listener/);
  assert.match(chartReadme, /GitHub registration, runner labels, scale policy/u);
} finally {
  rmSync(generatedCharts, { recursive: true, force: true });
  rmSync(generatedLock, { force: true });
  rmSync(helmHome, { recursive: true, force: true });
}
