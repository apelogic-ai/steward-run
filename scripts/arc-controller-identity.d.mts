export const supportedArcVersion: "0.14.2";

export interface ControllerIdentityInput {
  namespace: string;
  releaseName: string;
  serviceAccountName?: string;
}

export interface ControllerIdentity {
  arcVersion: "0.14.2";
  namespace: string;
  releaseName: string;
  deploymentName: string;
  serviceAccountName: string;
  serviceAccountDerived: boolean;
}

export function deriveControllerName(releaseName: string): string;
export function resolveControllerIdentity(input: ControllerIdentityInput): ControllerIdentity;
