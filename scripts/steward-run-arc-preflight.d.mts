import type { ControllerIdentity } from "./arc-controller-identity.mjs";

export class PreflightError extends Error {
  code: string;
}

export function evaluateControllerState(
  namespace: Record<string, any>,
  deployment: Record<string, any>,
  serviceAccount: Record<string, any>,
  identity: ControllerIdentity,
): void;

export function evaluateRunnerLinkage(
  roleBindings: Record<string, any>,
  identity: ControllerIdentity,
  runnerNamespace: string,
  scaleSetName: string,
): void;
