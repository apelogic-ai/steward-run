// src/config.ts
function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`required action input ${name} is missing`);
  }
  return value;
}
function readActionConfig(environment) {
  const agentRuntime = environment.STEWARD_RUN_AGENT_RUNTIME?.trim();
  return {
    workflow: required(environment, "STEWARD_RUN_WORKFLOW"),
    inputPaths: required(environment, "STEWARD_RUN_INPUTS"),
    outputPaths: required(environment, "STEWARD_RUN_OUTPUTS"),
    apiUrl: required(environment, "STEWARD_RUN_API_URL"),
    oidcAudience: required(environment, "STEWARD_RUN_OIDC_AUDIENCE"),
    ...agentRuntime ? { agentRuntime } : {},
    codingAgentRuntime: environment.STEWARD_RUN_CODING_AGENT_RUNTIME?.trim() || "claude-code@2.1.220"
  };
}

// src/main.ts
async function main() {
  readActionConfig(process.env);
  throw new Error("Steward run lifecycle is not implemented yet");
}
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`steward-run: ${message}
`);
    process.exitCode = 1;
  });
}
export {
  main
};
