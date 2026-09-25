interface CommonWorkflowConfig {
  inputPaths: string;
  outputPaths: string;
  apiUrl: string;
}

export type WorkflowConfig = CommonWorkflowConfig & (
  | { workflow: string; invocationPath?: never; agentRuntime?: string }
  | { invocationPath: string; workflow?: never; agentRuntime?: never }
);

export type ActionAuthentication =
  | { kind: "github-oidc-discovery" }
  | { kind: "github-oidc-exchange"; url: string; audience?: string }
  | { kind: "github-oidc"; audience: string }
  | { kind: "bearer-token-file"; path: string };

export type ActionConfig = WorkflowConfig & {
  authentication: ActionAuthentication;
  caCertificateFile?: string;
};

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`required action input ${name} is missing`);
  }
  return value;
}

function requiredVerbatim(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value?.trim()) {
    throw new Error(`required action input ${name} is missing`);
  }
  return value;
}

export function readActionConfig(environment: NodeJS.ProcessEnv): ActionConfig {
  const workflow = environment.STEWARD_RUN_WORKFLOW;
  const invocationPath = environment.STEWARD_RUN_INVOCATION_PATH;
  const agentRuntime = environment.STEWARD_RUN_AGENT_RUNTIME?.trim();
  const identityExchangeUrl = environment.STEWARD_RUN_IDENTITY_EXCHANGE_URL?.trim();
  const identityExchangeAudience = environment.STEWARD_RUN_IDENTITY_EXCHANGE_AUDIENCE?.trim();
  const oidcAudience = environment.STEWARD_RUN_OIDC_AUDIENCE?.trim();
  const bearerTokenFile = environment.STEWARD_RUN_BEARER_TOKEN_FILE?.trim();
  const caCertificateFile = environment.STEWARD_RUN_CA_CERTIFICATE_FILE?.trim();
  const apiUrl = required(environment, "STEWARD_RUN_API_URL");
  const taskSourceCount = [workflow?.trim(), invocationPath].filter(Boolean).length;
  if (taskSourceCount !== 1) {
    throw new Error("configure exactly one Task source: workflow or invocation-path");
  }
  if (invocationPath && agentRuntime) {
    throw new Error("agent-runtime cannot be selected for a direct package invocation");
  }
  if (identityExchangeAudience && !identityExchangeUrl) {
    throw new Error("identity-exchange-audience requires identity-exchange-url");
  }
  const authenticationCount = [identityExchangeUrl, oidcAudience, bearerTokenFile].filter(Boolean)
    .length;
  if (authenticationCount > 1) {
    throw new Error(
      "configure at most one explicit authentication method: identity-exchange-url, oidc-audience, or bearer-token-file",
    );
  }
  if (oidcAudience) {
    let api: URL;
    try {
      api = new URL(apiUrl);
    } catch {
      throw new Error("steward-api-url must be a valid URL");
    }
    const loopback =
      api.hostname === "localhost" || api.hostname === "127.0.0.1" || api.hostname === "::1";
    if (!loopback) {
      throw new Error(
        "direct GitHub OIDC authentication is only allowed with a loopback Steward API",
      );
    }
  }
  const authentication: ActionAuthentication = identityExchangeUrl
    ? {
        kind: "github-oidc-exchange",
        url: identityExchangeUrl,
        ...(identityExchangeAudience ? { audience: identityExchangeAudience } : {}),
      }
    : oidcAudience
      ? { kind: "github-oidc", audience: oidcAudience }
      : bearerTokenFile
        ? { kind: "bearer-token-file", path: bearerTokenFile }
        : { kind: "github-oidc-discovery" };
  const common = {
    inputPaths: required(environment, "STEWARD_RUN_INPUTS"),
    outputPaths: required(environment, "STEWARD_RUN_OUTPUTS"),
    apiUrl,
    authentication,
    ...(caCertificateFile ? { caCertificateFile } : {}),
  };
  return invocationPath
    ? { ...common, invocationPath }
    : {
        ...common,
        workflow: requiredVerbatim(environment, "STEWARD_RUN_WORKFLOW"),
        ...(agentRuntime ? { agentRuntime } : {}),
      };
}

export const compatibilityInputNames = [
  "identity-exchange-url",
  "identity-exchange-audience",
  "steward-ca-certificate-file",
] as const;

export function usedCompatibilityInputs(
  environment: NodeJS.ProcessEnv,
): Array<(typeof compatibilityInputNames)[number]> {
  const variables: Record<(typeof compatibilityInputNames)[number], string> = {
    "identity-exchange-url": "STEWARD_RUN_IDENTITY_EXCHANGE_URL",
    "identity-exchange-audience": "STEWARD_RUN_IDENTITY_EXCHANGE_AUDIENCE",
    "steward-ca-certificate-file": "STEWARD_RUN_CA_CERTIFICATE_FILE",
  };
  return compatibilityInputNames.filter((name) => Boolean(environment[variables[name]]?.trim()));
}

export function compatibilityInputNotice(
  name: (typeof compatibilityInputNames)[number],
): string {
  const guidance: Record<(typeof compatibilityInputNames)[number], string> = {
    "identity-exchange-url": "omit it to discover authentication from Steward",
    "identity-exchange-audience": "omit it with the explicit endpoint to use its historical default, or omit both exchange inputs to use discovery",
    "steward-ca-certificate-file": "omit it to use normal process/system trust",
  };
  return `${name} is deprecated and retained for compatibility; ${guidance[name]}. Removal requires a separately reviewed major-version migration.`;
}
