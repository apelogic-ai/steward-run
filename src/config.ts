export interface ActionConfig {
  workflow: string;
  inputPaths: string;
  outputPaths: string;
  apiUrl: string;
  oidcAudience: string;
  agentRuntime?: string;
  codingAgentRuntime: string;
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
  return {
    workflow: required(environment, "STEWARD_RUN_WORKFLOW"),
    inputPaths: required(environment, "STEWARD_RUN_INPUTS"),
    outputPaths: required(environment, "STEWARD_RUN_OUTPUTS"),
    apiUrl: required(environment, "STEWARD_RUN_API_URL"),
    oidcAudience: required(environment, "STEWARD_RUN_OIDC_AUDIENCE"),
    ...(agentRuntime ? { agentRuntime } : {}),
    codingAgentRuntime:
      environment.STEWARD_RUN_CODING_AGENT_RUNTIME?.trim() || "claude-code@2.1.220",
  };
}

