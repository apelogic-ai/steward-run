import { setTimeout as delay } from "node:timers/promises";
import { Readable } from "node:stream";
import {
  sanitizeCorrelationId,
  type RequestFailureCategory,
  type RequestStage,
} from "./failure-metadata.js";
import type { FetchLike } from "./oidc.js";

export type RuntimeOwnership = "provisioned" | "adopted";

export const taskPhases = [
  "submitted",
  "parked",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type TaskPhase = (typeof taskPhases)[number];

interface ModelRef {
  provider: string;
  model: string;
}

interface ToolGrant {
  provider: string;
  resource: string;
  action: string;
}

export type TaskAdmissionDelta =
  | { dimension: "budget"; requested: string; ceiling: string; currency: string }
  | { dimension: "ttl"; requested: string; ceiling: string }
  | { dimension: "models"; requested: ModelRef[]; ceiling: ModelRef[] }
  | { dimension: "tools"; requested: ToolGrant[]; ceiling: ToolGrant[] };

export interface Task {
  taskUid: string;
  runtimeUid: string | null;
  phase: TaskPhase;
  runtimeOwnership: RuntimeOwnership;
  finalized: boolean;
  failureReason?: string;
  deltas: TaskAdmissionDelta[];
}

export interface TaskSubmissionRequest {
  workflow: string;
  codingAgentRuntime: string;
  agentRuntimeUid?: string;
}

interface ClientOptions {
  baseUrl: string;
  getToken: () => Promise<string>;
  fetch?: FetchLike;
  sleep?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
}

interface RequestOptions {
  stage: RequestStage;
  expectedStatus: number | readonly number[];
  headers?: Record<string, string>;
  body?: BodyInit | (() => Promise<BodyInit>);
  duplex?: "half";
}

interface RequestFailureDetails {
  httpStatus?: number;
  correlationId?: string;
}

export class StewardRequestFailure extends Error {
  readonly stage: RequestStage;
  readonly category: RequestFailureCategory;
  readonly httpStatus: number | undefined;
  readonly correlationId: string | undefined;

  constructor(
    stage: RequestStage,
    category: RequestFailureCategory,
    details: RequestFailureDetails = {},
  ) {
    super(
      `Steward request failed (stage=${stage}, category=${category}` +
        `${details.httpStatus === undefined ? "" : `, status=${details.httpStatus}`})`,
    );
    this.name = "StewardRequestFailure";
    this.stage = stage;
    this.category = category;
    this.httpStatus = details.httpStatus;
    this.correlationId = sanitizeCorrelationId(details.correlationId);
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseModelRef(value: unknown): ModelRef | undefined {
  const item = record(value);
  return item &&
    hasOnlyKeys(item, ["provider", "model"]) &&
    typeof item.provider === "string" &&
    item.provider &&
    typeof item.model === "string" &&
    item.model
    ? { provider: item.provider, model: item.model }
    : undefined;
}

function parseToolGrant(value: unknown): ToolGrant | undefined {
  const item = record(value);
  return item &&
    hasOnlyKeys(item, ["provider", "resource", "action"]) &&
    typeof item.provider === "string" &&
    item.provider &&
    typeof item.resource === "string" &&
    item.resource &&
    typeof item.action === "string" &&
    item.action
    ? { provider: item.provider, resource: item.resource, action: item.action }
    : undefined;
}

function parseItems<T>(value: unknown, parse: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value.map(parse);
  return parsed.every((item): item is T => item !== undefined) ? parsed : undefined;
}

function parseTaskDelta(value: unknown): TaskAdmissionDelta | undefined {
  const delta = record(value);
  if (!delta || typeof delta.dimension !== "string") return undefined;
  if (
    delta.dimension === "budget" &&
    hasOnlyKeys(delta, ["dimension", "requested", "ceiling", "currency"]) &&
    typeof delta.requested === "string" &&
    typeof delta.ceiling === "string" &&
    typeof delta.currency === "string"
  ) {
    return {
      dimension: "budget",
      requested: delta.requested,
      ceiling: delta.ceiling,
      currency: delta.currency,
    };
  }
  if (
    delta.dimension === "ttl" &&
    hasOnlyKeys(delta, ["dimension", "requested", "ceiling"]) &&
    typeof delta.requested === "string" &&
    typeof delta.ceiling === "string"
  ) {
    return { dimension: "ttl", requested: delta.requested, ceiling: delta.ceiling };
  }
  if (delta.dimension === "models" && hasOnlyKeys(delta, ["dimension", "requested", "ceiling"])) {
    const requested = parseItems(delta.requested, parseModelRef);
    const ceiling = parseItems(delta.ceiling, parseModelRef);
    if (requested && ceiling) return { dimension: "models", requested, ceiling };
  }
  if (delta.dimension === "tools" && hasOnlyKeys(delta, ["dimension", "requested", "ceiling"])) {
    const requested = parseItems(delta.requested, parseToolGrant);
    const ceiling = parseItems(delta.ceiling, parseToolGrant);
    if (requested && ceiling) return { dimension: "tools", requested, ceiling };
  }
  return undefined;
}

const pendingBindingPhases = new Set<TaskPhase>(["submitted", "parked", "queued"]);

function isPendingBindingTask(task: Task): boolean {
  return task.runtimeUid === null &&
    task.runtimeOwnership === "provisioned" &&
    !task.finalized &&
    pendingBindingPhases.has(task.phase) &&
    task.failureReason === undefined;
}

function isUnboundFinalizationTask(task: Task): boolean {
  return task.runtimeUid === null &&
    task.runtimeOwnership === "provisioned" &&
    task.phase === "cancelled" &&
    task.failureReason === undefined;
}

function parseTask(payload: unknown): Task {
  const value = record(payload);
  const rawDeltas = value?.deltas ?? [];
  const deltas = parseItems(rawDeltas, parseTaskDelta);
  if (
    !value ||
    !hasOnlyKeys(value, [
      "taskUid",
      "runtimeUid",
      "phase",
      "runtimeOwnership",
      "finalized",
      "failureReason",
      "deltas",
    ]) ||
    typeof value.taskUid !== "string" ||
    !value.taskUid ||
    (value.runtimeUid !== null &&
      (typeof value.runtimeUid !== "string" || !value.runtimeUid)) ||
    typeof value.phase !== "string" ||
    !taskPhases.includes(value.phase as TaskPhase) ||
    (value.runtimeOwnership !== "provisioned" && value.runtimeOwnership !== "adopted") ||
    typeof value.finalized !== "boolean" ||
    (value.failureReason !== undefined && typeof value.failureReason !== "string") ||
    !deltas
  ) {
    throw new Error("Steward returned an incompatible Task response");
  }
  const task: Task = {
    taskUid: value.taskUid,
    runtimeUid: value.runtimeUid,
    phase: value.phase as TaskPhase,
    runtimeOwnership: value.runtimeOwnership,
    finalized: value.finalized,
    ...(typeof value.failureReason === "string" ? { failureReason: value.failureReason } : {}),
    deltas,
  };
  if (task.runtimeUid === null && !isPendingBindingTask(task) && !isUnboundFinalizationTask(task)) {
    throw new Error("Steward returned a contradictory unbound Task response");
  }
  return task;
}

function validatedBaseUrl(value: string): URL {
  const url = new URL(value);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Steward API URL must use HTTPS except on loopback");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("Steward API URL must not contain credentials or a fragment");
  }
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function retryDelay(response: Response | undefined, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter && /^\d+$/u.test(retryAfter)) {
    return Math.min(Number(retryAfter) * 1_000, 30_000);
  }
  return Math.min(250 * 2 ** attempt, 4_000);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function transportFailureCategory(error: unknown): "timeout" | "transport" {
  const candidates: unknown[] = [error];
  if (error && typeof error === "object" && "cause" in error) candidates.push(error.cause);
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const code = "code" in candidate && typeof candidate.code === "string" ? candidate.code : "";
    if (["ECONNABORTED", "ETIMEDOUT"].includes(code)) return "timeout";
  }
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return "timeout";
  return "transport";
}

function httpFailureCategory(status: number): RequestFailureCategory {
  if (status === 400 || status === 422) return "validation";
  if (status === 401) return "authentication";
  if (status === 403) return "authorization";
  if (status === 409) return "conflict";
  return "dependency";
}

function responseCorrelationId(response: Response): string | undefined {
  return sanitizeCorrelationId(response.headers.get("x-correlation-id")) ??
    sanitizeCorrelationId(response.headers.get("x-request-id"));
}

export class StewardClient {
  readonly #baseUrl: URL;
  readonly #getToken: () => Promise<string>;
  readonly #fetch: FetchLike;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #maxAttempts: number;

  constructor(options: ClientOptions) {
    this.#baseUrl = validatedBaseUrl(options.baseUrl);
    this.#getToken = options.getToken;
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? (async (milliseconds) => delay(milliseconds));
    this.#maxAttempts = options.maxAttempts ?? 4;
  }

  async #request(method: string, path: string, options: RequestOptions): Promise<Response> {
    const url = new URL(path.replace(/^\//u, ""), this.#baseUrl);
    for (let attempt = 0; attempt < this.#maxAttempts; attempt += 1) {
      const token = await this.#getToken();
      let response: Response | undefined;
      try {
        const body =
          typeof options.body === "function" ? await options.body() : options.body;
        response = await this.#fetch(url, {
          method,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            ...options.headers,
          },
          ...(body === undefined ? {} : { body }),
          ...(options.duplex ? { duplex: options.duplex } : {}),
        });
      } catch (error) {
        if (attempt + 1 === this.#maxAttempts) {
          throw new StewardRequestFailure(options.stage, transportFailureCategory(error));
        }
        await this.#sleep(retryDelay(undefined, attempt));
        continue;
      }
      const expectedStatuses = Array.isArray(options.expectedStatus)
        ? options.expectedStatus
        : [options.expectedStatus];
      if (expectedStatuses.includes(response.status)) return response;
      if (isRetryableStatus(response.status) && attempt + 1 < this.#maxAttempts) {
        await response.body?.cancel().catch(() => undefined);
        await this.#sleep(retryDelay(response, attempt));
        continue;
      }
      await response.body?.cancel().catch(() => undefined);
      const correlationId = responseCorrelationId(response);
      throw new StewardRequestFailure(options.stage, httpFailureCategory(response.status), {
        httpStatus: response.status,
        ...(correlationId === undefined ? {} : { correlationId }),
      });
    }
    throw new StewardRequestFailure(options.stage, "transport");
  }

  async #taskResponse(response: Response, stage: RequestStage): Promise<Task> {
    const payload: unknown = await response.json().catch(() => undefined);
    try {
      const task = parseTask(payload);
      if (task.runtimeUid === null) {
        const operationAllowsNull =
          (stage === "submit" && response.status === 202 && isPendingBindingTask(task)) ||
          (stage === "poll" &&
            (isPendingBindingTask(task) || isUnboundFinalizationTask(task))) ||
          (stage === "finalize" && isUnboundFinalizationTask(task));
        if (!operationAllowsNull) {
          throw new Error("Steward returned an unbound Task in an incompatible response");
        }
      }
      return task;
    } catch {
      const correlationId = responseCorrelationId(response);
      throw new StewardRequestFailure(stage, "malformed-response", {
        httpStatus: response.status,
        ...(correlationId === undefined ? {} : { correlationId }),
      });
    }
  }

  async submitTask(request: TaskSubmissionRequest, idempotencyKey: string): Promise<Task> {
    const response = await this.#request("POST", "v1/tasks", {
      stage: "submit",
      expectedStatus: [201, 202],
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(request),
    });
    return this.#taskResponse(response, "submit");
  }

  async uploadTaskInputs(taskUid: string, createArchive: () => Promise<Readable>): Promise<void> {
    await this.#request("PUT", `v1/tasks/${encodeURIComponent(taskUid)}/inputs`, {
      stage: "upload",
      expectedStatus: 204,
      headers: { "content-type": "application/x-tar" },
      body: async () => (await createArchive()) as unknown as BodyInit,
      duplex: "half",
    });
  }

  async executeTask(taskUid: string): Promise<Task> {
    return this.#taskResponse(
      await this.#request("POST", `v1/tasks/${encodeURIComponent(taskUid)}/execute`, {
        stage: "execute",
        expectedStatus: 202,
      }),
      "execute",
    );
  }

  async getTask(taskUid: string): Promise<Task> {
    return this.#taskResponse(
      await this.#request("GET", `v1/tasks/${encodeURIComponent(taskUid)}`, {
        stage: "poll",
        expectedStatus: 200,
      }),
      "poll",
    );
  }

  async downloadTaskOutputs(taskUid: string): Promise<Readable> {
    const response = await this.#request(
      "GET",
      `v1/tasks/${encodeURIComponent(taskUid)}/outputs`,
      {
        stage: "output",
        expectedStatus: 200,
        headers: { accept: "application/x-tar" },
      },
    );
    if (!response.headers.get("content-type")?.startsWith("application/x-tar") || !response.body) {
      const correlationId = responseCorrelationId(response);
      throw new StewardRequestFailure("output", "malformed-response", {
        httpStatus: response.status,
        ...(correlationId === undefined ? {} : { correlationId }),
      });
    }
    return Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  }

  async finalizeTask(taskUid: string): Promise<Task> {
    return this.#taskResponse(
      await this.#request("DELETE", `v1/tasks/${encodeURIComponent(taskUid)}`, {
        stage: "finalize",
        expectedStatus: 202,
      }),
      "finalize",
    );
  }

}
