#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const supportedArcVersion = "0.14.2";
const controllerBaseName = "gha-rs-controller";
const dnsLabel = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/u;

function requireDnsLabel(value, option) {
  if (!value || value.length > 63 || !dnsLabel.test(value)) {
    throw new Error(`${option} must be a non-empty Kubernetes DNS label of at most 63 characters`);
  }
  return value;
}

export function deriveControllerName(releaseName) {
  requireDnsLabel(releaseName, "controller release name");
  const candidate = releaseName.includes(controllerBaseName)
    ? releaseName
    : `${releaseName}-${controllerBaseName}`;
  return candidate.slice(0, 63).replace(/-+$/u, "");
}

export function resolveControllerIdentity({ namespace, releaseName, serviceAccountName }) {
  const controllerNamespace = requireDnsLabel(namespace, "controller namespace");
  const controllerReleaseName = requireDnsLabel(releaseName, "controller release name");
  const deploymentName = deriveControllerName(controllerReleaseName);
  const resolvedServiceAccountName = serviceAccountName
    ? requireDnsLabel(serviceAccountName, "controller ServiceAccount name")
    : deploymentName;

  return {
    arcVersion: supportedArcVersion,
    namespace: controllerNamespace,
    releaseName: controllerReleaseName,
    deploymentName,
    serviceAccountName: resolvedServiceAccountName,
    serviceAccountDerived: !serviceAccountName,
  };
}

function parseArguments(argv) {
  const options = { output: "json" };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!["--namespace", "--release-name", "--service-account-name", "--output"].includes(option) || !value) {
      throw new Error(`unknown or incomplete option: ${option ?? "<missing>"}`);
    }
    const key = {
      "--namespace": "namespace",
      "--release-name": "releaseName",
      "--service-account-name": "serviceAccountName",
      "--output": "output",
    }[option];
    if (options[key] !== undefined && key !== "output") throw new Error(`${option} may be specified only once`);
    options[key] = value;
    index += 1;
  }
  if (!options.namespace) throw new Error("--namespace is required");
  if (!options.releaseName) throw new Error("--release-name is required");
  if (!["json", "values"].includes(options.output)) throw new Error("--output must be json or values");
  return options;
}

function valuesYaml(identity) {
  return [
    "gha-runner-scale-set:",
    "  controllerServiceAccount:",
    `    namespace: ${identity.namespace}`,
    `    name: ${identity.serviceAccountName}`,
    "",
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const identity = resolveControllerIdentity(options);
    process.stdout.write(options.output === "values" ? valuesYaml(identity) : `${JSON.stringify(identity, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`arc-controller-identity: ${error.message}\n`);
    process.exitCode = 2;
  }
}
