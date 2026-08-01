export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit & { duplex?: "half" },
) => Promise<Response>;

export async function getGitHubOidcToken(
  requestUrl: string,
  requestToken: string,
  audience: string,
  fetchImplementation: FetchLike = fetch,
): Promise<string> {
  if (!requestUrl || !requestToken) {
    throw new Error(
      "GitHub OIDC is unavailable; grant the job id-token: write permission",
    );
  }
  const url = new URL(requestUrl);
  if (url.protocol !== "https:") throw new Error("GitHub OIDC request URL must use HTTPS");
  url.searchParams.set("audience", audience);
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${requestToken}`,
      },
    });
  } catch {
    throw new Error("GitHub OIDC token request failed");
  }
  if (!response.ok) {
    throw new Error(`GitHub OIDC token request failed with status ${response.status}`);
  }
  const payload: unknown = await response.json().catch(() => undefined);
  const value =
    payload && typeof payload === "object" && "value" in payload
      ? (payload as { value?: unknown }).value
      : undefined;
  if (typeof value !== "string" || value.split(".").length !== 3) {
    throw new Error("GitHub OIDC token response was incompatible");
  }
  return value;
}

export function oidcTokenProvider(
  environment: NodeJS.ProcessEnv,
  audience: string,
  fetchImplementation: FetchLike = fetch,
): () => Promise<string> {
  return async () =>
    getGitHubOidcToken(
      environment.ACTIONS_ID_TOKEN_REQUEST_URL ?? "",
      environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? "",
      audience,
      fetchImplementation,
    );
}

