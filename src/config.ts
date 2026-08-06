export interface WorkflowConfig {
  workflow: string;
  inputPaths: string;
  outputPaths: string;
  apiUrl: string;
  agentRuntime?: string;
  codingAgentRuntime: string;
}

export type ActionAuthentication =
  | { kind: "github-oidc-exchange"; url: string }
  | { kind: "github-oidc"; audience: string }
  | { kind: "bearer-token-file"; path: string };

export interface ActionConfig extends WorkflowConfig {
  authentication: ActionAuthentication;
  caCertificateFile?: string;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`required action input ${name} is missing`);
  }
  return value;
}

export function readActionConfig(environment: NodeJS.ProcessEnv): ActionConfig {
  const agentRuntime = environment.STEWARD_RUN_AGENT_RUNTIME?.trim();
  const identityExchangeUrl = environment.STEWARD_RUN_IDENTITY_EXCHANGE_URL?.trim();
  const oidcAudience = environment.STEWARD_RUN_OIDC_AUDIENCE?.trim();
  const bearerTokenFile = environment.STEWARD_RUN_BEARER_TOKEN_FILE?.trim();
  const caCertificateFile = environment.STEWARD_RUN_CA_CERTIFICATE_FILE?.trim();
  const apiUrl = required(environment, "STEWARD_RUN_API_URL");
  const authenticationCount = [identityExchangeUrl, oidcAudience, bearerTokenFile].filter(Boolean)
    .length;
  if (authenticationCount !== 1) {
    throw new Error(
      "configure exactly one authentication method: identity-exchange-url, oidc-audience, or bearer-token-file",
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
  return {
    workflow: required(environment, "STEWARD_RUN_WORKFLOW"),
    inputPaths: required(environment, "STEWARD_RUN_INPUTS"),
    outputPaths: required(environment, "STEWARD_RUN_OUTPUTS"),
    apiUrl,
    ...(agentRuntime ? { agentRuntime } : {}),
    codingAgentRuntime:
      environment.STEWARD_RUN_CODING_AGENT_RUNTIME?.trim() || "claude-code@2.1.220",
    authentication: identityExchangeUrl
      ? { kind: "github-oidc-exchange", url: identityExchangeUrl }
      : oidcAudience
        ? { kind: "github-oidc", audience: oidcAudience }
        : { kind: "bearer-token-file", path: bearerTokenFile as string },
    ...(caCertificateFile ? { caCertificateFile } : {}),
  };
}
