export const FAILURE_METADATA_VERSION = "steward-run.failure/v1" as const;

export const failurePhases = ["succeeded", "failed", "cancelled", "unavailable"] as const;
export type FailurePhase = (typeof failurePhases)[number];

export const failureCategories = [
  "provider-connection",
  "provider-token-grant",
  "provider-grant",
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
]);

export function classifyFailureReason(reason: string | undefined): FailureCategory {
  if (reason === undefined) return "unknown";
  const normalized = reason.trim().toLowerCase();
  const agentExit = /^task agent exited with code ([0-9]+)$/u.exec(normalized);
  if (agentExit) {
    const code = Number(agentExit[1]);
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
  return {
    version: FAILURE_METADATA_VERSION,
    phase: allowed(failurePhases, value.phase) ? value.phase : "unavailable",
    failureCategory: allowed(failureCategories, value.failureCategory)
      ? value.failureCategory
      : "unknown",
    cleanupCategory: allowed(cleanupCategories, value.cleanupCategory)
      ? value.cleanupCategory
      : "unknown",
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
  await sink.writeStepSummary(
    [
      "## Steward governed Task failure",
      "",
      "| Contract | Phase | Failure category | Cleanup category |",
      "| --- | --- | --- | --- |",
      `| ${FAILURE_METADATA_VERSION} | ${safe.phase} | ${safe.failureCategory} | ${safe.cleanupCategory} |`,
      "",
    ].join("\n"),
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
