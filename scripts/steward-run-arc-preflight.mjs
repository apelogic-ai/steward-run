#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { resolveControllerIdentity, supportedArcVersion } from "./arc-controller-identity.mjs";

export class PreflightError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PreflightError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PreflightError(code, message);
}

export function evaluateControllerState(namespace, deployment, serviceAccount, identity) {
  if (namespace?.metadata?.name !== identity.namespace) {
    fail("controller-namespace-mismatch", `controller namespace identity mismatch: expected ${identity.namespace}`);
  }
  const annotations = deployment?.metadata?.annotations ?? {};
  const labels = deployment?.metadata?.labels ?? {};
  if (
    annotations["meta.helm.sh/release-name"] !== identity.releaseName ||
    annotations["meta.helm.sh/release-namespace"] !== identity.namespace ||
    labels["app.kubernetes.io/instance"] !== identity.releaseName ||
    labels["app.kubernetes.io/part-of"] !== "gha-rs-controller"
  ) {
    fail(
      "controller-release-mismatch",
      `deployment ${identity.namespace}/${identity.deploymentName} is not owned by ARC Helm release ${identity.releaseName}`,
    );
  }
  const expectedChart = `gha-rs-controller-${supportedArcVersion}`;
  const actualChart = labels["helm.sh/chart"];
  const podVersion = deployment?.spec?.template?.metadata?.labels?.["app.kubernetes.io/version"];
  if (actualChart !== expectedChart || podVersion !== supportedArcVersion) {
    fail(
      "arc-version-incompatible",
      `ARC controller version is incompatible: expected ${supportedArcVersion}, found chart=${actualChart ?? "missing"} pod=${podVersion ?? "missing"}`,
    );
  }
  const actualServiceAccount = deployment?.spec?.template?.spec?.serviceAccountName;
  if (
    serviceAccount?.metadata?.name !== identity.serviceAccountName ||
    serviceAccount?.metadata?.namespace !== identity.namespace ||
    actualServiceAccount !== identity.serviceAccountName ||
    labels["actions.github.com/controller-service-account-name"] !== identity.serviceAccountName ||
    labels["actions.github.com/controller-service-account-namespace"] !== identity.namespace
  ) {
    fail(
      "controller-service-account-mismatch",
      `controller ServiceAccount mismatch: expected ${identity.namespace}/${identity.serviceAccountName}, deployment uses ${actualServiceAccount ?? "missing"}`,
    );
  }
}

export function evaluateRunnerLinkage(roleBindings, identity, runnerNamespace, scaleSetName) {
  const items = roleBindings?.items ?? [];
  if (items.length !== 1) {
    fail(
      items.length === 0 ? "runner-linkage-missing" : "runner-linkage-ambiguous",
      `expected exactly one manager RoleBinding for scale set ${runnerNamespace}/${scaleSetName}; found ${items.length}`,
    );
  }
  const subjects = items[0]?.subjects ?? [];
  const linked = subjects.some(
    (subject) =>
      subject?.kind === "ServiceAccount" &&
      subject?.namespace === identity.namespace &&
      subject?.name === identity.serviceAccountName,
  );
  if (!linked) {
    fail(
      "runner-linkage-mismatch",
      `scale set ${runnerNamespace}/${scaleSetName} is not linked to ${identity.namespace}/${identity.serviceAccountName}`,
    );
  }
}

function parseArguments(argv) {
  if (argv.includes("--help")) return { help: true };
  const options = { output: "text" };
  const keys = {
    "--namespace": "namespace",
    "--release-name": "releaseName",
    "--service-account-name": "serviceAccountName",
    "--runner-namespace": "runnerNamespace",
    "--runner-scale-set-name": "runnerScaleSetName",
    "--kubeconfig": "kubeconfig",
    "--context": "context",
    "--output": "output",
  };
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    const key = keys[option];
    if (!key || !value || (options[key] !== undefined && key !== "output")) {
      throw new PreflightError("invalid-arguments", `unknown, duplicate, or incomplete option: ${option ?? "<missing>"}`);
    }
    options[key] = value;
  }
  if (!options.namespace || !options.releaseName) {
    fail("invalid-arguments", "--namespace and --release-name are required");
  }
  if ((options.runnerNamespace && !options.runnerScaleSetName) || (!options.runnerNamespace && options.runnerScaleSetName)) {
    fail("invalid-arguments", "--runner-namespace and --runner-scale-set-name must be supplied together");
  }
  if (!["text", "json"].includes(options.output)) fail("invalid-arguments", "--output must be text or json");
  return options;
}

function usage() {
  return `Usage: steward-run-arc-preflight.mjs --namespace NAMESPACE --release-name RELEASE [options]

Read-only checks:
  --service-account-name NAME  Exact controller ServiceAccount override
  --runner-namespace NAME      Runner namespace (requires --runner-scale-set-name)
  --runner-scale-set-name NAME Verify the installed manager RoleBinding linkage
  --kubeconfig PATH            kubectl kubeconfig
  --context NAME               kubectl context
  --output text|json           Human or machine-readable result (default: text)
`;
}

function kubectl(options, args, missingCode, missingMessage) {
  const common = [];
  if (options.kubeconfig) common.push("--kubeconfig", options.kubeconfig);
  if (options.context) common.push("--context", options.context);
  const result = spawnSync("kubectl", [...common, ...args, "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error?.code === "ENOENT") fail("kubectl-not-found", "kubectl was not found in PATH");
  if (result.status !== 0) fail(missingCode, missingMessage);
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail("kubectl-output-invalid", `kubectl returned invalid JSON while reading ${args.slice(0, 3).join(" ")}`);
  }
}

function run(options) {
  const identity = resolveControllerIdentity(options);
  const namespace = kubectl(
    options,
    ["get", "namespace", identity.namespace],
    "controller-namespace-not-found",
    `controller namespace not found: ${identity.namespace}`,
  );
  const deployment = kubectl(
    options,
    ["get", "deployment", identity.deploymentName, "--namespace", identity.namespace],
    "controller-deployment-not-found",
    `controller deployment not found: ${identity.namespace}/${identity.deploymentName}`,
  );
  const serviceAccount = kubectl(
    options,
    ["get", "serviceaccount", identity.serviceAccountName, "--namespace", identity.namespace],
    "controller-service-account-not-found",
    `controller ServiceAccount not found: ${identity.namespace}/${identity.serviceAccountName}`,
  );
  evaluateControllerState(namespace, deployment, serviceAccount, identity);

  let runnerLinkage = "not-requested";
  if (options.runnerNamespace) {
    kubectl(
      options,
      ["get", "namespace", options.runnerNamespace],
      "runner-namespace-not-found",
      `runner namespace not found: ${options.runnerNamespace}`,
    );
    const roleBindings = kubectl(
      options,
      [
        "get",
        "rolebindings",
        "--namespace",
        options.runnerNamespace,
        "--selector",
        `actions.github.com/scale-set-name=${options.runnerScaleSetName},app.kubernetes.io/component=manager-role-binding`,
      ],
      "runner-linkage-query-failed",
      `could not read manager RoleBinding for scale set ${options.runnerNamespace}/${options.runnerScaleSetName}`,
    );
    evaluateRunnerLinkage(roleBindings, identity, options.runnerNamespace, options.runnerScaleSetName);
    runnerLinkage = "verified";
  }
  return { status: "ok", identity, runnerLinkage };
}

function printSuccess(result, output) {
  if (output === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const { identity } = result;
  process.stdout.write(
    [
      `PASS ARC ${identity.arcVersion} controller ${identity.namespace}/${identity.deploymentName}`,
      `PASS controller ServiceAccount ${identity.namespace}/${identity.serviceAccountName}`,
      result.runnerLinkage === "verified" ? "PASS runner scale-set linkage" : "SKIP runner linkage (not requested)",
      "Helm values:",
      "gha-runner-scale-set:",
      "  controllerServiceAccount:",
      `    namespace: ${identity.namespace}`,
      `    name: ${identity.serviceAccountName}`,
      "",
    ].join("\n"),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  let output = process.argv.includes("--output")
    ? process.argv[process.argv.indexOf("--output") + 1]
    : "text";
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
    } else {
      printSuccess(run(options), options.output);
    }
  } catch (error) {
    const failure = error instanceof PreflightError
      ? error
      : new PreflightError("preflight-internal-error", error.message);
    if (output === "json") {
      process.stdout.write(`${JSON.stringify({ status: "error", code: failure.code, message: failure.message })}\n`);
    } else {
      process.stderr.write(`FAIL [${failure.code}] ${failure.message}\n`);
    }
    process.exitCode = 1;
  }
}
