import { readFile } from "node:fs/promises";

const maximumTokenLifetimeSeconds = 60 * 60;
const minimumRemainingLifetimeSeconds = 30;
const allowedClockSkewSeconds = 60;

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

function validateShortLivedToken(token: string, nowSeconds: number): string {
  const claims = jwtClaims(token);
  const issuedAt = claims?.iat;
  const expiresAt = claims?.exp;
  if (
    !Number.isInteger(issuedAt) ||
    !Number.isInteger(expiresAt) ||
    (issuedAt as number) > nowSeconds + allowedClockSkewSeconds ||
    (expiresAt as number) - (issuedAt as number) > maximumTokenLifetimeSeconds ||
    (expiresAt as number) - (issuedAt as number) <= 0 ||
    (expiresAt as number) - nowSeconds < minimumRemainingLifetimeSeconds
  ) {
    throw new Error("bearer-token file contains an invalid short-lived bearer token");
  }
  return token;
}

export function shortLivedBearerTokenFileProvider(
  path: string,
  now: () => number = () => Math.floor(Date.now() / 1_000),
): () => Promise<string> {
  return async () => {
    let token: string;
    try {
      token = (await readFile(path, "utf8")).trim();
    } catch {
      throw new Error("bearer-token file could not be read");
    }
    return validateShortLivedToken(token, now());
  };
}
