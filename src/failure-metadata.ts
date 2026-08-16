export const FAILURE_METADATA_VERSION = "steward-run.failure/v1" as const;
export const ASSERTION_STAGE_METADATA_VERSION = "steward-run.assertion-stage/v1" as const;
export const PROVIDER_CONNECTION_STAGE_METADATA_VERSION = "steward-run.provider-connection-stage/v1" as const;
// v1 remains stable for the already-published coarse signal. v2 distinguishes
// a local proxy rejection from an upstream LiteLLM HTTP response without
// exposing request or response data.
export const PROVIDER_CONNECTION_STAGE_V2_METADATA_VERSION = "steward-run.provider-connection-stage/v2" as const;

export const failurePhases = ["succeeded", "failed", "cancelled", "unavailable"] as const;
export type FailurePhase = (typeof failurePhases)[number];

export const failureCategories = [
  "provider-connection",
  "provider-token-grant",
  "provider-grant",
  "provider-protocol",
  "provider-authorization",
  "provider-upstream",
  "assertion-mismatch",
  "workflow-cleanup",
  "authentication",
  "authorization",
  "configuration",
  "dependency",
  "input-output",
  "runtime",
  "timeout",
  "execution",
  "cancelled",
  "unknown",
] as const;
export type FailureCategory = (typeof failureCategories)[number];

export const assertionStages = [
  "input-request",
  "runtime-toolchain",
  "model-result",
  "mcp-tool-event",
] as const;
export type AssertionStage = (typeof assertionStages)[number];

export const providerConnectionStages = [
  "model-proxy-start",
  "model-request",
  "model-gateway",
  "agent-after-model",
] as const;
export type ProviderConnectionStage = (typeof providerConnectionStages)[number];

export const providerConnectionStagesV2 = [
  "model-proxy-start",
  "model-request",
  "model-proxy-contract",
  "litellm-http",
  "agent-after-model",
] as const;
export type ProviderConnectionStageV2 = (typeof providerConnectionStagesV2)[number];

export const cleanupCategories = [
  "confirmed",
  "not-required",
  "request-failed",
  "confirmation-timeout",
  "identity-mismatch",
  "unknown",
] as const;
export type CleanupCategory = (typeof cleanupCategories)[number];

export interface FailureMetadata {
  version: typeof FAILURE_METADATA_VERSION;
  phase: FailurePhase;
  failureCategory: FailureCategory;
  cleanupCategory: CleanupCategory;
  assertionStage?: AssertionStage;
  providerConnectionStage?: ProviderConnectionStage;
  providerConnectionStageV2?: ProviderConnectionStageV2;
}

export interface FailureMetadataSink {
  writeAnnotation(value: string): Promise<void>;
  writeStepSummary(value: string): Promise<void>;
}

const agentExitCategories = new Map<number, FailureCategory>([
  [70, "provider-connection"],
  [71, "provider-token-grant"],
  [72, "provider-authorization"],
  [73, "provider-upstream"],
  [74, "assertion-mismatch"],
  [75, "workflow-cleanup"],
  [76, "provider-grant"],
  [77, "provider-protocol"],
  [78, "assertion-mismatch"],
  [79, "assertion-mismatch"],
  [80, "assertion-mismatch"],
  [81, "assertion-mismatch"],
  [82, "provider-connection"],
  [83, "provider-connection"],
  [84, "provider-connection"],
  [85, "provider-connection"],
  [86, "provider-connection"],
]);

const agentExitAssertionStages = new Map<number, AssertionStage>([
  [78, "input-request"],
  [79, "runtime-toolchain"],
  [80, "model-result"],
  [81, "mcp-tool-event"],
]);

const agentExitProviderConnectionStages = new Map<number, ProviderConnectionStage>([
  [82, "model-proxy-start"],
  [83, "model-request"],
  [84, "model-gateway"],
  [85, "agent-after-model"],
  [86, "agent-after-model"],
]);

const agentExitProviderConnectionStagesV2 = new Map<number, ProviderConnectionStageV2>([
  [82, "model-proxy-start"],
  [83, "model-request"],
  [84, "model-proxy-contract"],
  [85, "litellm-http"],
  [86, "agent-after-model"],
]);

function exactAgentExitCode(reason: string | undefined): number | undefined {
  if (reason === undefined) return undefined;
  const exactAgentExit = /^task agent exited with code ([0-9]+)$/u.exec(reason.toLowerCase());
  return exactAgentExit ? Number(exactAgentExit[1]) : undefined;
}

export function classifyAssertionStage(reason: string | undefined): AssertionStage | undefined {
  const code = exactAgentExitCode(reason);
  return code === undefined ? undefined : agentExitAssertionStages.get(code);
}

export function classifyProviderConnectionStage(reason: string | undefined): ProviderConnectionStage | undefined {
  const code = exactAgentExitCode(reason);
  return code === undefined ? undefined : agentExitProviderConnectionStages.get(code);
}

export function classifyProviderConnectionStageV2(reason: string | undefined): ProviderConnectionStageV2 | undefined {
  const code = exactAgentExitCode(reason);
  return code === undefined ? undefined : agentExitProviderConnectionStagesV2.get(code);
}

export function classifyFailureReason(reason: string | undefined): FailureCategory {
  if (reason === undefined) return "unknown";
  const exactAgentExit = exactAgentExitCode(reason);
  if (exactAgentExit !== undefined) {
    const code = exactAgentExit;
    return agentExitCategories.get(code) ?? "execution";
  }
  const normalized = reason.trim().toLowerCase();
  const agentExit = /^task agent exited with code ([0-9]+)$/u.exec(normalized);
  if (agentExit) {
    const code = Number(agentExit[1]);
    if (code === 77) return "execution";
    return agentExitCategories.get(code) ?? "execution";
  }
  if (/\b(timeout|timed out|deadline)\b/u.test(normalized)) return "timeout";
  if (/\b(unauthenticated|authentication|oidc|token|credential)\b/u.test(normalized)) {
    return "authentication";
  }
  if (/\b(unauthorized|authorization|forbidden|denied|policy|grant)\b/u.test(normalized)) {
    return "authorization";
  }
  if (/\b(config|configuration|profile|catalog|workflow)\b/u.test(normalized)) {
    return "configuration";
  }
  if (/\b(upstream|unavailable|connection|gateway|provider)\b/u.test(normalized)) {
    return "dependency";
  }
  if (/\b(input|output|archive|artifact)\b/u.test(normalized)) return "input-output";
  if (/\b(runtime|sandbox|openshell|agent)\b/u.test(normalized)) return "runtime";
  if (/\b(execution|command|process|exit|exited)\b/u.test(normalized)) return "execution";
  return "unknown";
}

function allowed<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

export function sanitizeFailureMetadata(value: FailureMetadata): FailureMetadata {
  const failureCategory = allowed(failureCategories, value.failureCategory)
    ? value.failureCategory
    : "unknown";
  const assertionStage = failureCategory === "assertion-mismatch" &&
      allowed(assertionStages, value.assertionStage)
    ? value.assertionStage
    : undefined;
  const providerConnectionStage = failureCategory === "provider-connection" &&
      allowed(providerConnectionStages, value.providerConnectionStage)
    ? value.providerConnectionStage
    : undefined;
  const providerConnectionStageV2 = failureCategory === "provider-connection" &&
      allowed(providerConnectionStagesV2, value.providerConnectionStageV2)
    ? value.providerConnectionStageV2
    : undefined;
  return {
    version: FAILURE_METADATA_VERSION,
    phase: allowed(failurePhases, value.phase) ? value.phase : "unavailable",
    failureCategory,
    cleanupCategory: allowed(cleanupCategories, value.cleanupCategory)
      ? value.cleanupCategory
      : "unknown",
    ...(assertionStage === undefined ? {} : { assertionStage }),
    ...(providerConnectionStage === undefined ? {} : { providerConnectionStage }),
    ...(providerConnectionStageV2 === undefined ? {} : { providerConnectionStageV2 }),
  };
}

function compact(metadata: FailureMetadata): string {
  return `${FAILURE_METADATA_VERSION} phase=${metadata.phase} failure-category=${metadata.failureCategory} cleanup-category=${metadata.cleanupCategory}`;
}

export async function publishFailureMetadata(
  metadata: FailureMetadata,
  sink: FailureMetadataSink,
): Promise<void> {
  const safe = sanitizeFailureMetadata(metadata);
  await sink.writeAnnotation(compact(safe));
  if (safe.assertionStage !== undefined) {
    await sink.writeAnnotation(
      `${ASSERTION_STAGE_METADATA_VERSION} stage=${safe.assertionStage}`,
    );
  }
  if (safe.providerConnectionStage !== undefined) {
    await sink.writeAnnotation(
      `${PROVIDER_CONNECTION_STAGE_METADATA_VERSION} stage=${safe.providerConnectionStage}`,
    );
  }
  if (safe.providerConnectionStageV2 !== undefined) {
    await sink.writeAnnotation(
      `${PROVIDER_CONNECTION_STAGE_V2_METADATA_VERSION} stage=${safe.providerConnectionStageV2}`,
    );
  }
  const summary = [
    "## Steward governed Task failure",
    "",
    "| Contract | Phase | Failure category | Cleanup category |",
    "| --- | --- | --- | --- |",
    `| ${FAILURE_METADATA_VERSION} | ${safe.phase} | ${safe.failureCategory} | ${safe.cleanupCategory} |`,
  ];
  if (safe.assertionStage !== undefined) {
    summary.push(
      "",
      "| Contract | Assertion stage |",
      "| --- | --- |",
      `| ${ASSERTION_STAGE_METADATA_VERSION} | ${safe.assertionStage} |`,
    );
  }
  if (safe.providerConnectionStage !== undefined) {
    summary.push(
      "",
      "| Contract | Provider connection stage |",
      "| --- | --- |",
      `| ${PROVIDER_CONNECTION_STAGE_METADATA_VERSION} | ${safe.providerConnectionStage} |`,
    );
  }
  if (safe.providerConnectionStageV2 !== undefined) {
    summary.push(
      "",
      "| Contract | Provider connection stage |",
      "| --- | --- |",
      `| ${PROVIDER_CONNECTION_STAGE_V2_METADATA_VERSION} | ${safe.providerConnectionStageV2} |`,
    );
  }
  summary.push("");
  await sink.writeStepSummary(
    summary.join("\n"),
  );
}

export class StewardRunFailure extends Error {
  readonly metadata: FailureMetadata;

  constructor(metadata: FailureMetadata) {
    const safe = sanitizeFailureMetadata(metadata);
    super(
      `Steward governed Task failed (phase=${safe.phase}, failure-category=${safe.failureCategory}, cleanup-category=${safe.cleanupCategory})`,
    );
    this.name = "StewardRunFailure";
    this.metadata = safe;
  }
}
