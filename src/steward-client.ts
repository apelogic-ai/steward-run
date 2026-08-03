import { setTimeout as delay } from "node:timers/promises";
import { Readable } from "node:stream";
import type { FetchLike } from "./oidc.js";

export const runPhases = [
  "accepted",
  "materializing",
  "running",
  "collecting",
  "succeeded",
  "parked",
  "failed",
  "cancelled",
] as const;
export type RunPhase = (typeof runPhases)[number];
export type RuntimeOwnership = "provisioned" | "adopted";

export interface Run {
  runUid: string;
  runtimeUid: string;
  phase: RunPhase;
  runtimeOwnership: RuntimeOwnership;
  finalized: boolean;
  message?: string;
}

export interface CreateRunRequest {
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
  expectedStatus: number;
  headers?: Record<string, string>;
  body?: BodyInit | (() => Promise<BodyInit>);
  duplex?: "half";
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

function parseRun(payload: unknown): Run {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Steward returned an incompatible run response");
  }
  const value = payload as Record<string, unknown>;
  const allowed = new Set(["runUid", "runtimeUid", "phase", "runtimeOwnership", "finalized", "message"]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    typeof value.runUid !== "string" ||
    !value.runUid ||
    typeof value.runtimeUid !== "string" ||
    !value.runtimeUid ||
    typeof value.phase !== "string" ||
    !runPhases.includes(value.phase as RunPhase) ||
    (value.runtimeOwnership !== "provisioned" && value.runtimeOwnership !== "adopted") ||
    typeof value.finalized !== "boolean" ||
    (value.message !== undefined && typeof value.message !== "string")
  ) {
    throw new Error("Steward returned an incompatible run response");
  }
  return {
    runUid: value.runUid,
    runtimeUid: value.runtimeUid,
    phase: value.phase as RunPhase,
    runtimeOwnership: value.runtimeOwnership,
    finalized: value.finalized,
    ...(typeof value.message === "string" ? { message: value.message } : {}),
  };
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
        if (error instanceof Error && error.name === "AbortError") throw error;
        if (attempt + 1 === this.#maxAttempts) {
          throw new Error(`Steward request ${method} ${path} failed after retries`);
        }
        await this.#sleep(retryDelay(undefined, attempt));
        continue;
      }
      if (response.status === options.expectedStatus) return response;
      if (isRetryableStatus(response.status) && attempt + 1 < this.#maxAttempts) {
        await response.body?.cancel().catch(() => undefined);
        await this.#sleep(retryDelay(response, attempt));
        continue;
      }
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Steward request ${method} ${path} failed with status ${response.status}`);
    }
    throw new Error(`Steward request ${method} ${path} exhausted retries`);
  }

  async #runResponse(response: Response): Promise<Run> {
    const payload: unknown = await response.json().catch(() => undefined);
    return parseRun(payload);
  }

  async createRun(request: CreateRunRequest, idempotencyKey: string): Promise<Run> {
    const response = await this.#request("POST", "v1/runs", {
      expectedStatus: 201,
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(request),
    });
    return this.#runResponse(response);
  }

  async uploadInputs(runUid: string, createArchive: () => Promise<Readable>): Promise<void> {
    await this.#request("PUT", `v1/runs/${encodeURIComponent(runUid)}/inputs`, {
      expectedStatus: 204,
      headers: { "content-type": "application/x-tar" },
      body: async () => (await createArchive()) as unknown as BodyInit,
      duplex: "half",
    });
  }

  async executeRun(runUid: string): Promise<Run> {
    return this.#runResponse(
      await this.#request("POST", `v1/runs/${encodeURIComponent(runUid)}/execute`, {
        expectedStatus: 202,
      }),
    );
  }

  async getRun(runUid: string): Promise<Run> {
    return this.#runResponse(
      await this.#request("GET", `v1/runs/${encodeURIComponent(runUid)}`, {
        expectedStatus: 200,
      }),
    );
  }

  async downloadOutputs(runUid: string): Promise<Readable> {
    const response = await this.#request("GET", `v1/runs/${encodeURIComponent(runUid)}/outputs`, {
      expectedStatus: 200,
      headers: { accept: "application/x-tar" },
    });
    if (!response.headers.get("content-type")?.startsWith("application/x-tar") || !response.body) {
      throw new Error("Steward returned an incompatible output archive response");
    }
    return Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  }

  async finalizeRun(runUid: string): Promise<Run> {
    return this.#runResponse(
      await this.#request("DELETE", `v1/runs/${encodeURIComponent(runUid)}`, {
        expectedStatus: 202,
      }),
    );
  }
}
