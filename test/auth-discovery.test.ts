import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverTaskAuthentication,
  discoveredIdentityExchangeTokenProvider,
} from "../src/auth-discovery.ts";
import { STEWARD_TASK_API_AUDIENCE } from "../src/identity-exchange.ts";
import type { FetchLike } from "../src/oidc.ts";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("discovery follows RFC well-known paths and selects the advertised audience", async () => {
  const requests: Request[] = [];
  const fetchImplementation: FetchLike = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.url === "https://steward.example/.well-known/oauth-protected-resource/api?tenant=1") {
      return json({
        resource: "https://steward.example/api?tenant=1",
        authorization_servers: ["https://identity.example/tenant"],
      });
    }
    return json({
      issuer: "https://identity.example/tenant",
      token_endpoint: "https://identity.example/v1/exchange",
      github_oidc_audience: "github-exchange-audience",
    });
  };

  assert.deepEqual(
    await discoverTaskAuthentication("https://steward.example/api?tenant=1", fetchImplementation),
    {
      issuer: "https://identity.example/tenant",
      exchangeUrl: "https://identity.example/v1/exchange",
      githubOidcAudience: "github-exchange-audience",
    },
  );
  assert.deepEqual(
    requests.map((request) => [request.method, request.url, request.redirect]),
    [
      ["GET", "https://steward.example/.well-known/oauth-protected-resource/api?tenant=1", "manual"],
      ["GET", "https://identity.example/.well-known/oauth-authorization-server/tenant", "manual"],
    ],
  );
});

test("the issuer URL is the documented GitHub OIDC audience fallback", async () => {
  const discovered = await discoverTaskAuthentication(
    "https://steward.example/",
    async (input) =>
      String(input).includes("oauth-protected-resource")
        ? json({ resource: "https://steward.example/", authorization_servers: ["https://identity.example/"] })
        : json({ issuer: "https://identity.example/", token_endpoint: "https://identity.example/exchange" }),
  );
  assert.equal(discovered.githubOidcAudience, "https://identity.example/");
});

test("the discovered provider caches metadata and requests the exact advertised audience", async () => {
  const now = 1_800_000_000;
  const sourceToken = jwt({ aud: "exact-discovered-audience", sub: "github-caller" });
  const stewardToken = jwt({ aud: STEWARD_TASK_API_AUDIENCE, iat: now, exp: now + 120 });
  const seen: string[] = [];
  const sourceFetch: FetchLike = async (input, init) => {
    const request = new Request(input, init);
    seen.push(request.url);
    assert.equal(new URL(request.url).searchParams.get("audience"), "exact-discovered-audience");
    return json({ value: sourceToken });
  };
  const discoveryAndExchangeFetch: FetchLike = async (input, init) => {
    const request = new Request(input, init);
    seen.push(request.url);
    if (request.url.includes("oauth-protected-resource")) {
      return json({
        resource: "https://steward.example/",
        authorization_servers: ["https://identity.example/"],
      });
    }
    if (request.url.includes("oauth-authorization-server")) {
      return json({
        issuer: "https://identity.example/",
        token_endpoint: "https://identity.example/exchange",
        github_oidc_audience: "exact-discovered-audience",
      });
    }
    assert.equal(request.headers.get("authorization"), `Bearer ${sourceToken}`);
    return json({ access_token: stewardToken, token_type: "Bearer", expires_in: 120 });
  };
  const provider = discoveredIdentityExchangeTokenProvider(
    {
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example/id",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
    },
    "https://steward.example/",
    sourceFetch,
    () => now,
    discoveryAndExchangeFetch,
  );

  assert.equal(await provider(), stewardToken);
  assert.equal(await provider(), stewardToken);
  assert.equal(seen.filter((url) => url.includes("oauth-protected-resource")).length, 1);
  assert.equal(seen.filter((url) => url.includes("oauth-authorization-server")).length, 1);
  assert.equal(seen.filter((url) => url === "https://identity.example/exchange").length, 2);
});

test("a wrongly advertised audience fails at the GitHub OIDC boundary", async () => {
  const provider = discoveredIdentityExchangeTokenProvider(
    {
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example/id",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
    },
    "https://steward.example/",
    async (input) => {
      assert.equal(new URL(String(input)).searchParams.get("audience"), "wrong-audience");
      return json({ error: "audience rejected" }, 400);
    },
    () => 1_800_000_000,
    async (input) =>
      String(input).includes("oauth-protected-resource")
        ? json({
            resource: "https://steward.example/",
            authorization_servers: ["https://identity.example/"],
          })
        : json({
            issuer: "https://identity.example/",
            token_endpoint: "https://identity.example/exchange",
            github_oidc_audience: "wrong-audience",
          }),
  );
  await assert.rejects(provider(), /GitHub OIDC token request failed with status 400/u);
});

test("discovery rejects mismatches, ambiguous issuers, and unsafe URLs", async (context) => {
  const cases: Array<[string, string, unknown, unknown, RegExp]> = [
    ["resource mismatch", "https://steward.example/", { resource: "https://other.example/", authorization_servers: ["https://identity.example/"] }, {}, /protected-resource metadata was incompatible/u],
    ["missing issuer", "https://steward.example/", { resource: "https://steward.example/", authorization_servers: [] }, {}, /protected-resource metadata was incompatible/u],
    ["multiple issuers", "https://steward.example/", { resource: "https://steward.example/", authorization_servers: ["https://one.example/", "https://two.example/"] }, {}, /protected-resource metadata was incompatible/u],
    ["plaintext issuer", "https://steward.example/", { resource: "https://steward.example/", authorization_servers: ["http://identity.example/"] }, {}, /HTTPS except on loopback/u],
    ["credentialed issuer", "https://steward.example/", { resource: "https://steward.example/", authorization_servers: ["https://user:pass@identity.example/"] }, {}, /credentials or a fragment/u],
    ["fragmented issuer", "https://steward.example/", { resource: "https://steward.example/", authorization_servers: ["https://identity.example/#fragment"] }, {}, /credentials or a fragment/u],
    ["issuer mismatch", "https://steward.example/", { resource: "https://steward.example/", authorization_servers: ["https://identity.example/"] }, { issuer: "https://other.example/", token_endpoint: "https://identity.example/exchange" }, /authorization-server metadata was incompatible/u],
    ["plaintext exchange", "https://steward.example/", { resource: "https://steward.example/", authorization_servers: ["https://identity.example/"] }, { issuer: "https://identity.example/", token_endpoint: "http://identity.example/exchange" }, /HTTPS except on loopback/u],
    ["invalid audience", "https://steward.example/", { resource: "https://steward.example/", authorization_servers: ["https://identity.example/"] }, { issuer: "https://identity.example/", token_endpoint: "https://identity.example/exchange", github_oidc_audience: "" }, /invalid GitHub OIDC audience/u],
  ];
  for (const [name, resource, protectedMetadata, identityMetadata, expected] of cases) {
    await context.test(name, async () => {
      await assert.rejects(
        discoverTaskAuthentication(resource, async (input) =>
          String(input).includes("oauth-protected-resource")
            ? json(protectedMetadata)
            : json(identityMetadata),
        ),
        expected,
      );
    });
  }
  await assert.rejects(
    discoverTaskAuthentication("http://steward.example/", async () => json({})),
    /HTTPS except on loopback/u,
  );
  await assert.rejects(
    discoverTaskAuthentication(`https://steward.example/${"x".repeat(2_048)}`, async () => json({})),
    /exceeds 2048 characters/u,
  );
});

test("discovery rejects redirects, oversized bodies, invalid media, and timeouts", async (context) => {
  await context.test("redirect", async () => {
    await assert.rejects(
      discoverTaskAuthentication(
        "https://steward.example/",
        async () => new Response(null, { status: 302, headers: { location: "https://attacker.example/" } }),
      ),
      /redirects are not allowed/u,
    );
  });
  await context.test("oversized", async () => {
    await assert.rejects(
      discoverTaskAuthentication(
        "https://steward.example/",
        async () => new Response("x".repeat(33), { headers: { "content-type": "application/json" } }),
        undefined,
        { maximumResponseBytes: 32 },
      ),
      /exceeds 32 bytes/u,
    );
  });
  await context.test("invalid media", async () => {
    await assert.rejects(
      discoverTaskAuthentication(
        "https://steward.example/",
        async () => new Response("{}", { headers: { "content-type": "text/plain" } }),
      ),
      /must use application\/json/u,
    );
  });
  await context.test("unavailable", async () => {
    await assert.rejects(
      discoverTaskAuthentication("https://steward.example/", async () => json({}, 503)),
      /failed with status 503/u,
    );
  });
  await context.test("timeout", async () => {
    await assert.rejects(
      discoverTaskAuthentication(
        "https://steward.example/",
        async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
        undefined,
        { requestTimeoutMilliseconds: 5, totalTimeoutMilliseconds: 20 },
      ),
      /timed out/u,
    );
  });
  await context.test("response body timeout", async () => {
    await assert.rejects(
      discoverTaskAuthentication(
        "https://steward.example/",
        async () => new Response(new ReadableStream({ start() {} }), {
          headers: { "content-type": "application/json" },
        }),
        undefined,
        { requestTimeoutMilliseconds: 5, totalTimeoutMilliseconds: 20 },
      ),
      /timed out/u,
    );
  });
});

test("resource and issuer identifiers are compared exactly without adding root slashes", async () => {
  const discovered = await discoverTaskAuthentication(
    "https://steward.example",
    async (input) =>
      String(input).includes("oauth-protected-resource")
        ? json({ resource: "https://steward.example", authorization_servers: ["https://identity.example"] })
        : json({ issuer: "https://identity.example", token_endpoint: "https://identity.example/exchange" }),
  );
  assert.equal(discovered.issuer, "https://identity.example");
  assert.equal(discovered.githubOidcAudience, "https://identity.example");
});
