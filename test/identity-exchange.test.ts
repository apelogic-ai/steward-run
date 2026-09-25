import assert from "node:assert/strict";
import test from "node:test";
import {
  GITHUB_IDENTITY_EXCHANGE_AUDIENCE,
  STEWARD_TASK_API_AUDIENCE,
  identityExchangeTokenProvider,
} from "../src/identity-exchange.ts";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
    },
  });
}

const now = 1_800_000_000;
const sourceToken = jwt({ aud: GITHUB_IDENTITY_EXCHANGE_AUDIENCE, sub: "github-caller" });
const stewardToken = jwt({
  aud: STEWARD_TASK_API_AUDIENCE,
  exp: now + 120,
  iat: now,
  sub: "corporate-user",
});

test("identity exchange requests the fixed GitHub audience and returns the Steward token", async () => {
  const requests: Request[] = [];
  const controller = new AbortController();
  const provider = identityExchangeTokenProvider(
    {
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-secret",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example/id?api-version=1",
    },
    "https://identity.example/v1/exchange",
    async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.startsWith("https://token.actions.example/")) {
        return jsonResponse({ value: sourceToken });
      }
      return jsonResponse({ access_token: stewardToken, expires_in: 120, token_type: "Bearer" });
    },
    () => now,
  );

  assert.equal(await provider(controller.signal), stewardToken);
  assert.equal(requests.length, 2);

  const oidcRequest = requests[0];
  assert.equal(oidcRequest?.method, "GET");
  assert.equal(oidcRequest?.headers.get("authorization"), "Bearer github-request-secret");
  assert.equal(
    new URL(oidcRequest?.url ?? "").searchParams.get("audience"),
    GITHUB_IDENTITY_EXCHANGE_AUDIENCE,
  );

  const exchangeRequest = requests[1];
  assert.equal(exchangeRequest?.url, "https://identity.example/v1/exchange");
  assert.equal(exchangeRequest?.method, "POST");
  assert.equal(exchangeRequest?.headers.get("authorization"), `Bearer ${sourceToken}`);
  assert.equal(exchangeRequest?.headers.get("accept"), "application/json");
  assert.equal(await exchangeRequest?.text(), "");
  assert.doesNotMatch(exchangeRequest?.headers.get("authorization") ?? "", new RegExp(stewardToken));
  controller.abort();
  assert.equal(oidcRequest?.signal.aborted, true);
  assert.equal(exchangeRequest?.signal.aborted, true);
});

test("identity exchange can use a private-CA transport without replacing GitHub OIDC trust", async () => {
  const sourceRequests: Request[] = [];
  const exchangeRequests: Request[] = [];
  const provider = identityExchangeTokenProvider(
    {
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-secret",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example/id",
    },
    "https://identity.example/v1/exchange",
    async (input, init) => {
      sourceRequests.push(new Request(input, init));
      return jsonResponse({ value: sourceToken });
    },
    () => now,
    GITHUB_IDENTITY_EXCHANGE_AUDIENCE,
    async (input, init) => {
      exchangeRequests.push(new Request(input, init));
      return jsonResponse({ access_token: stewardToken, expires_in: 120, token_type: "Bearer" });
    },
  );

  assert.equal(await provider(), stewardToken);
  assert.equal(sourceRequests.length, 1);
  assert.equal(exchangeRequests.length, 1);
  assert.equal(sourceRequests[0]?.url.startsWith("https://token.actions.example/"), true);
  assert.equal(exchangeRequests[0]?.url, "https://identity.example/v1/exchange");
});

test("identity exchange requires HTTPS except for loopback tests", async () => {
  assert.throws(
    () =>
      identityExchangeTokenProvider(
        {},
        "http://identity.example/v1/exchange",
        fetch,
      ),
    /HTTPS except on loopback/,
  );
  assert.doesNotThrow(() =>
    identityExchangeTokenProvider({}, "http://127.0.0.1:8080/v1/exchange", fetch),
  );
});

test("identity exchange failures never disclose either token", async () => {
  const provider = identityExchangeTokenProvider(
    {
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-secret",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example/id",
    },
    "https://identity.example/v1/exchange",
    async (input) =>
      String(input).startsWith("https://token.actions.example/")
        ? jsonResponse({ value: sourceToken })
        : new Response(`rejected ${sourceToken} ${stewardToken}`, { status: 401 }),
    () => now,
  );

  await assert.rejects(provider(), (error: Error) => {
    assert.match(error.message, /status 401/);
    assert.doesNotMatch(
      error.message,
      new RegExp(`${sourceToken}|${stewardToken}|github-request-secret`),
    );
    return true;
  });
});

test("identity exchange fails closed on malformed or unsafe responses", async (context) => {
  const malformedResponses: Array<[string, Response]> = [
    ["invalid JSON", new Response("not-json", { headers: { "content-type": "application/json" } })],
    ["missing token", jsonResponse({ expires_in: 120, token_type: "Bearer" })],
    ["wrong token type", jsonResponse({ access_token: stewardToken, expires_in: 120, token_type: "MAC" })],
    ["invalid expiry", jsonResponse({ access_token: stewardToken, expires_in: 0, token_type: "Bearer" })],
    [
      "wrong audience",
      jsonResponse({
        access_token: jwt({ aud: "some-other-api", exp: now + 120, iat: now }),
        expires_in: 120,
        token_type: "Bearer",
      }),
    ],
    [
      "long-lived token",
      jsonResponse({
        access_token: jwt({ aud: STEWARD_TASK_API_AUDIENCE, exp: now + 3_601, iat: now }),
        expires_in: 3_601,
        token_type: "Bearer",
      }),
    ],
  ];

  for (const [name, exchangeResponse] of malformedResponses) {
    await context.test(name, async () => {
      const provider = identityExchangeTokenProvider(
        {
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-secret",
          ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example/id",
        },
        "https://identity.example/v1/exchange",
        async (input) =>
          String(input).startsWith("https://token.actions.example/")
            ? jsonResponse({ value: sourceToken })
            : exchangeResponse.clone(),
        () => now,
      );
      await assert.rejects(provider(), /identity exchange response was incompatible/);
    });
  }
});

test("identity exchange does not follow redirects or accept oversized responses", async () => {
  const environment = {
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-secret",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example/id",
  };
  const sourceFetch = async () => jsonResponse({ value: sourceToken });
  const redirected = identityExchangeTokenProvider(
    environment,
    "https://identity.example/v1/exchange",
    sourceFetch,
    () => now,
    GITHUB_IDENTITY_EXCHANGE_AUDIENCE,
    async (_input, init) => {
      assert.equal(init?.redirect, "manual");
      return new Response(null, { status: 302, headers: { location: "https://attacker.example/" } });
    },
  );
  await assert.rejects(redirected(), /status 302/u);

  const oversized = identityExchangeTokenProvider(
    environment,
    "https://identity.example/v1/exchange",
    sourceFetch,
    () => now,
    GITHUB_IDENTITY_EXCHANGE_AUDIENCE,
    async () => new Response("x".repeat(64 * 1_024 + 1), { headers: { "content-type": "application/json" } }),
  );
  await assert.rejects(oversized(), /response was incompatible/u);
});
