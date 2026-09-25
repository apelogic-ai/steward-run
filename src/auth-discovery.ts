import { identityExchangeTokenProvider } from "./identity-exchange.js";
import type { FetchLike } from "./oidc.js";

export const GITHUB_OIDC_AUDIENCE_METADATA_FIELD = "github_oidc_audience";

const maximumUrlLength = 2_048;
const defaultMaximumResponseBytes = 64 * 1_024;
const defaultRequestTimeoutMilliseconds = 5_000;
const defaultTotalTimeoutMilliseconds = 10_000;

export interface DiscoveredTaskAuthentication {
  issuer: string;
  exchangeUrl: string;
  githubOidcAudience: string;
}

export interface DiscoveryOptions {
  maximumResponseBytes?: number;
  requestTimeoutMilliseconds?: number;
  totalTimeoutMilliseconds?: number;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function trustedUrl(value: string, label: string, allowQuery: boolean): URL {
  if (!value || value.length > maximumUrlLength) {
    throw new Error(`${label} is missing or exceeds ${maximumUrlLength} characters`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error(`${label} must use HTTPS except on loopback`);
  }
  if (url.username || url.password || url.hash) {
    throw new Error(`${label} must not contain credentials or a fragment`);
  }
  if (!allowQuery && url.search) {
    throw new Error(`${label} must not contain a query`);
  }
  if (url.href.length > maximumUrlLength) {
    throw new Error(`${label} exceeds ${maximumUrlLength} characters`);
  }
  return url;
}

function wellKnownUrl(base: URL, suffix: string): URL {
  const result = new URL(base.href);
  const path = base.pathname === "/" ? "" : base.pathname;
  result.pathname = `/.well-known/${suffix}${path}`;
  if (result.href.length > maximumUrlLength) {
    throw new Error("discovery metadata URL exceeds the supported length");
  }
  return result;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readWithSignal(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const aborted = () => {
      reader.cancel(signal.reason).then(
        () => reject(signal.reason),
        () => reject(signal.reason),
      );
    };
    signal.addEventListener("abort", aborted, { once: true });
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

async function boundedJson(
  response: Response,
  maximumBytes: number,
  label: string,
  signal: AbortSignal,
): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new Error(`${label} response must use application/json`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`${label} response exceeds ${maximumBytes} bytes`);
  }
  if (!response.body) throw new Error(`${label} response was empty`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await readWithSignal(reader, signal);
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new Error(`${label} response exceeds ${maximumBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks, length).toString("utf8");
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`${label} response was not valid JSON`);
  }
}

async function fetchMetadata(
  url: URL,
  label: string,
  fetchImplementation: FetchLike,
  externalSignal: AbortSignal | undefined,
  deadline: number,
  requestTimeoutMilliseconds: number,
  maximumResponseBytes: number,
): Promise<unknown> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("authentication discovery exceeded its total time limit");
  const timeout = AbortSignal.timeout(Math.max(1, Math.min(remaining, requestTimeoutMilliseconds)));
  const signal = externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "manual",
      signal,
    });
  } catch {
    if (externalSignal?.aborted) {
      const error = new Error("authentication discovery was cancelled");
      error.name = "AbortError";
      throw error;
    }
    if (timeout.aborted) throw new Error(`${label} request timed out`);
    throw new Error(`${label} request failed`);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`${label} redirects are not allowed`);
  }
  if (response.status !== 200) {
    throw new Error(`${label} request failed with status ${response.status}`);
  }
  try {
    return await boundedJson(response, maximumResponseBytes, label, signal);
  } catch (error) {
    if (externalSignal?.aborted) {
      const cancelled = new Error("authentication discovery was cancelled");
      cancelled.name = "AbortError";
      throw cancelled;
    }
    if (timeout.aborted) throw new Error(`${label} request timed out`);
    throw error;
  }
}

export async function discoverTaskAuthentication(
  stewardApiUrl: string,
  fetchImplementation: FetchLike = fetch,
  signal?: AbortSignal,
  options: DiscoveryOptions = {},
): Promise<DiscoveredTaskAuthentication> {
  const maximumResponseBytes = options.maximumResponseBytes ?? defaultMaximumResponseBytes;
  const requestTimeoutMilliseconds =
    options.requestTimeoutMilliseconds ?? defaultRequestTimeoutMilliseconds;
  const totalTimeoutMilliseconds =
    options.totalTimeoutMilliseconds ?? defaultTotalTimeoutMilliseconds;
  if (
    !Number.isSafeInteger(maximumResponseBytes) || maximumResponseBytes <= 0 ||
    !Number.isSafeInteger(requestTimeoutMilliseconds) || requestTimeoutMilliseconds <= 0 ||
    !Number.isSafeInteger(totalTimeoutMilliseconds) || totalTimeoutMilliseconds <= 0
  ) {
    throw new Error("authentication discovery limits must be positive integers");
  }
  const deadline = Date.now() + totalTimeoutMilliseconds;
  const resource = trustedUrl(stewardApiUrl, "steward-api-url", true);
  const protectedResourcePayload = record(
    await fetchMetadata(
      wellKnownUrl(resource, "oauth-protected-resource"),
      "Steward protected-resource metadata",
      fetchImplementation,
      signal,
      deadline,
      requestTimeoutMilliseconds,
      maximumResponseBytes,
    ),
  );
  const authorizationServers = protectedResourcePayload?.authorization_servers;
  if (
    protectedResourcePayload?.resource !== stewardApiUrl ||
    !Array.isArray(authorizationServers) ||
    authorizationServers.length !== 1 ||
    typeof authorizationServers[0] !== "string"
  ) {
    throw new Error("Steward protected-resource metadata was incompatible");
  }
  const issuerIdentifier = authorizationServers[0];
  const issuer = trustedUrl(issuerIdentifier, "Identity issuer", false);
  const identityPayload = record(
    await fetchMetadata(
      wellKnownUrl(issuer, "oauth-authorization-server"),
      "Identity authorization-server metadata",
      fetchImplementation,
      signal,
      deadline,
      requestTimeoutMilliseconds,
      maximumResponseBytes,
    ),
  );
  if (identityPayload?.issuer !== issuerIdentifier || typeof identityPayload.token_endpoint !== "string") {
    throw new Error("Identity authorization-server metadata was incompatible");
  }
  trustedUrl(identityPayload.token_endpoint, "Identity token endpoint", true);
  const advertisedAudience = identityPayload[GITHUB_OIDC_AUDIENCE_METADATA_FIELD];
  if (
    advertisedAudience !== undefined &&
    (typeof advertisedAudience !== "string" || !advertisedAudience || advertisedAudience.length > 1_024)
  ) {
    throw new Error("Identity authorization-server metadata advertised an invalid GitHub OIDC audience");
  }
  return {
    issuer: issuerIdentifier,
    exchangeUrl: identityPayload.token_endpoint,
    githubOidcAudience: advertisedAudience ?? issuerIdentifier,
  };
}

export function discoveredIdentityExchangeTokenProvider(
  environment: NodeJS.ProcessEnv,
  stewardApiUrl: string,
  sourceFetchImplementation: FetchLike = fetch,
  now: () => number = () => Math.floor(Date.now() / 1_000),
  discoveryAndExchangeFetchImplementation: FetchLike = sourceFetchImplementation,
  options: DiscoveryOptions = {},
): (signal?: AbortSignal) => Promise<string> {
  let cached: Promise<DiscoveredTaskAuthentication> | undefined;
  return async (signal) => {
    cached ??= discoverTaskAuthentication(
      stewardApiUrl,
      discoveryAndExchangeFetchImplementation,
      signal,
      options,
    ).catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
    const discovered = await cached;
    return identityExchangeTokenProvider(
      environment,
      discovered.exchangeUrl,
      sourceFetchImplementation,
      now,
      discovered.githubOidcAudience,
      discoveryAndExchangeFetchImplementation,
    )(signal);
  };
}
