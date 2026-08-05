export interface WorkflowConfig {
  workflow: string;
  inputPaths: string;
  outputPaths: string;
  apiUrl: string;
  agentRuntime?: string;
  codingAgentRuntime: string;
}

export type ActionAuthentication =
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
  const oidcAudience = environment.STEWARD_RUN_OIDC_AUDIENCE?.trim();
  const bearerTokenFile = environment.STEWARD_RUN_BEARER_TOKEN_FILE?.trim();
  const caCertificateFile = environment.STEWARD_RUN_CA_CERTIFICATE_FILE?.trim();
  if (Boolean(oidcAudience) === Boolean(bearerTokenFile)) {
    throw new Error("configure exactly one authentication method: oidc-audience or bearer-token-file");
  }
  return {
    workflow: required(environment, "STEWARD_RUN_WORKFLOW"),
    inputPaths: required(environment, "STEWARD_RUN_INPUTS"),
    outputPaths: required(environment, "STEWARD_RUN_OUTPUTS"),
    apiUrl: required(environment, "STEWARD_RUN_API_URL"),
    ...(agentRuntime ? { agentRuntime } : {}),
    codingAgentRuntime:
      environment.STEWARD_RUN_CODING_AGENT_RUNTIME?.trim() || "claude-code@2.1.220",
    authentication: oidcAudience
      ? { kind: "github-oidc", audience: oidcAudience }
      : { kind: "bearer-token-file", path: bearerTokenFile as string },
    ...(caCertificateFile ? { caCertificateFile } : {}),
  };
}
