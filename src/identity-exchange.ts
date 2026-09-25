import { type FetchLike, oidcTokenProvider } from "./oidc.js";

export const GITHUB_IDENTITY_EXCHANGE_AUDIENCE = "apelogic-github-identity-exchange";
export const STEWARD_TASK_API_AUDIENCE = "steward-task-api";

const maximumTokenLifetimeSeconds = 60 * 60;
const minimumRemainingLifetimeSeconds = 30;
const allowedClockSkewSeconds = 60;
const maximumExchangeUrlLength = 2_048;
const maximumExchangeResponseBytes = 64 * 1_024;

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function validateExchangeUrl(value: string): URL {
  if (!value || value.length > maximumExchangeUrlLength) {
    throw new Error(`identity-exchange-url is missing or exceeds ${maximumExchangeUrlLength} characters`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("identity-exchange-url must be a valid URL");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error("identity-exchange-url must use HTTPS except on loopback");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("identity-exchange-url must not contain credentials or a fragment");
  }
  if (url.href.length > maximumExchangeUrlLength) {
    throw new Error(`identity-exchange-url exceeds ${maximumExchangeUrlLength} characters`);
  }
  return url;
}

async function exchangePayload(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumExchangeResponseBytes) {
    throw new Error("identity exchange response was incompatible");
  }
  if (!response.body) throw new Error("identity exchange response was incompatible");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumExchangeResponseBytes) {
        await reader.cancel();
        throw new Error("identity exchange response was incompatible");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks, length).toString("utf8")) as unknown;
  } catch {
    throw new Error("identity exchange response was incompatible");
  }
}

function jwtClaims(token: string): Record<string, unknown> | undefined {
  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((segment) => !segment)) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segments[1] ?? "", "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function hasExactAudience(value: unknown, expected: string): boolean {
  return value === expected || (Array.isArray(value) && value.length === 1 && value[0] === expected);
}

function validateStewardToken(token: string, nowSeconds: number): string {
  const claims = jwtClaims(token);
  const issuedAt = claims?.iat;
  const expiresAt = claims?.exp;
  if (
    !hasExactAudience(claims?.aud, STEWARD_TASK_API_AUDIENCE) ||
    !Number.isInteger(issuedAt) ||
    !Number.isInteger(expiresAt) ||
    (issuedAt as number) > nowSeconds + allowedClockSkewSeconds ||
    (expiresAt as number) - (issuedAt as number) > maximumTokenLifetimeSeconds ||
    (expiresAt as number) - (issuedAt as number) <= 0 ||
    (expiresAt as number) - nowSeconds < minimumRemainingLifetimeSeconds
  ) {
    throw new Error("identity exchange response was incompatible");
  }
  return token;
}

export function identityExchangeTokenProvider(
  environment: NodeJS.ProcessEnv,
  exchangeUrl: string,
  sourceFetchImplementation: FetchLike = fetch,
  now: () => number = () => Math.floor(Date.now() / 1_000),
  audience: string = GITHUB_IDENTITY_EXCHANGE_AUDIENCE,
  exchangeFetchImplementation: FetchLike = sourceFetchImplementation,
): (signal?: AbortSignal) => Promise<string> {
  const url = validateExchangeUrl(exchangeUrl);
  const getSourceToken = oidcTokenProvider(
    environment,
    audience,
    sourceFetchImplementation,
  );

  return async (signal) => {
    const sourceToken = await getSourceToken(signal);
    let response: Response;
    try {
      response = await exchangeFetchImplementation(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${sourceToken}`,
        },
        redirect: "manual",
        ...(signal === undefined ? {} : { signal }),
      });
    } catch {
      if (signal?.aborted) {
        const error = new Error("identity exchange request was cancelled");
        error.name = "AbortError";
        throw error;
      }
      throw new Error("identity exchange request failed");
    }
    if (!response.ok) {
      throw new Error(`identity exchange request failed with status ${response.status}`);
    }

    const payload: unknown = await exchangePayload(response);
    const candidate =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : undefined;
    const token = candidate?.access_token;
    const tokenType = candidate?.token_type;
    const expiresIn = candidate?.expires_in;
    if (
      typeof token !== "string" ||
      tokenType !== "Bearer" ||
      !Number.isInteger(expiresIn) ||
      (expiresIn as number) <= 0 ||
      (expiresIn as number) > maximumTokenLifetimeSeconds
    ) {
      throw new Error("identity exchange response was incompatible");
    }
    return validateStewardToken(token, now());
  };
}
