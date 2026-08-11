import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import tar from "tar-stream";

const taskUid = "2f9f6ade-261d-4090-9532-9e157b59db2e";
const runtimeUid = "mock-runtime-uid";
const sourceAudience = "apelogic-github-identity-exchange";
const stewardAudience = "steward-task-api";
type MockOperation =
  | "submit"
  | "upload-inputs"
  | "execute"
  | "poll"
  | "download-outputs"
  | "finalize";

export interface MockSteward {
  url: string;
  observations: {
    created: boolean;
    uploaded: boolean;
    executed: boolean;
    polled: boolean;
    downloaded: boolean;
    finalized: boolean;
    oidcRequests: number;
    exchangeRequests: number;
    sourceTokenAtExchange: number;
    sourceTokenAtSteward: number;
    stewardTokenAtExchange: number;
    stewardTokenAtSteward: number;
    operations: MockOperation[];
  };
  close: () => Promise<void>;
}

export interface MockStewardOptions {
  finalizationMarker?: string;
  acceptExternalGithubOidcToken?: boolean;
  terminalFailureReason?: string;
}

async function requestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function uploadedPayload(body: Buffer): Promise<Buffer> {
  const extract = tar.extract();
  let payload: Buffer | undefined;
  extract.on("entry", (header, stream, next) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      if (header.name === "in/payload.bin") payload = Buffer.concat(chunks);
      next();
    })().catch((error: unknown) => next(error as Error));
  });
  await new Promise<void>((resolve, reject) => {
    extract.once("finish", resolve);
    extract.once("error", reject);
    extract.end(body);
  });
  if (!payload) throw new Error("mock input archive omitted in/payload.bin");
  return payload;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.mock-signature`;
}

function hasExactAudience(token: string, audience: string): boolean {
  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((segment) => !segment)) return false;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(segments[1] ?? "", "base64url").toString("utf8"),
    );
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const value = (payload as Record<string, unknown>).aud;
    return value === audience || (Array.isArray(value) && value.length === 1 && value[0] === audience);
  } catch {
    return false;
  }
}

function task(
  finalized: boolean,
  phase: "submitted" | "running" | "succeeded" | "failed",
  failureReason?: string,
) {
  return {
    taskUid,
    runtimeUid,
    phase,
    runtimeOwnership: "provisioned",
    finalized,
    deltas: [],
    ...(failureReason === undefined ? {} : { failureReason }),
  };
}

async function outputArchive(payload: Buffer): Promise<Buffer> {
  const pack = tar.pack();
  pack.entry({ name: "out", type: "directory" });
  pack.entry({ name: "out/payload.bin" }, payload);
  pack.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of pack) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function startMockSteward(options: MockStewardOptions = {}): Promise<MockSteward> {
  const observations: MockSteward["observations"] = {
    created: false,
    uploaded: false,
    executed: false,
    polled: false,
    downloaded: false,
    finalized: false,
    oidcRequests: 0,
    exchangeRequests: 0,
    sourceTokenAtExchange: 0,
    sourceTokenAtSteward: 0,
    stewardTokenAtExchange: 0,
    stewardTokenAtSteward: 0,
    operations: [],
  };
  const issuedAt = Math.floor(Date.now() / 1_000);
  const sourceToken = jwt({ aud: sourceAudience, sub: "mock-github-caller" });
  const stewardToken = jwt({
    aud: stewardAudience,
    exp: issuedAt + 120,
    iat: issuedAt,
    sub: "mock-corporate-user",
  });
  const acceptedSourceTokens = new Set([sourceToken]);
  let payload: Buffer<ArrayBufferLike> | undefined;
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/oidc") {
        observations.oidcRequests += 1;
        if (request.headers.authorization !== "Bearer request-secret") {
          json(response, 401, { message: "invalid request token" });
          return;
        }
        if (url.searchParams.get("audience") !== sourceAudience) {
          json(response, 400, { message: "invalid OIDC audience" });
          return;
        }
        json(response, 200, { value: sourceToken });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/exchange") {
        observations.exchangeRequests += 1;
        const bearer = request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
        if (bearer === stewardToken) observations.stewardTokenAtExchange += 1;
        const externalGithubOidcToken =
          options.acceptExternalGithubOidcToken && hasExactAudience(bearer, sourceAudience);
        if (bearer !== sourceToken && !externalGithubOidcToken) {
          json(response, 401, { error: "invalid_token" });
          return;
        }
        acceptedSourceTokens.add(bearer);
        observations.sourceTokenAtExchange += 1;
        if ((await requestBody(request)).length !== 0) {
          json(response, 400, { error: "invalid_request" });
          return;
        }
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json",
        });
        response.end(
          JSON.stringify({ access_token: stewardToken, expires_in: 120, token_type: "Bearer" }),
        );
        return;
      }
      const bearer = request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
      if (acceptedSourceTokens.has(bearer)) observations.sourceTokenAtSteward += 1;
      if (bearer !== stewardToken) {
        json(response, 401, { message: "invalid identity token" });
        return;
      }
      observations.stewardTokenAtSteward += 1;
      if (request.method === "POST" && url.pathname === "/v1/tasks") {
        const createRequest: unknown = JSON.parse((await requestBody(request)).toString("utf8"));
        if (
          !createRequest ||
          typeof createRequest !== "object" ||
          Array.isArray(createRequest) ||
          (createRequest as Record<string, unknown>).workflow !== "copy-smoke"
        ) {
          json(response, 400, { message: "mock only supports workflow copy-smoke" });
          return;
        }
        observations.created = true;
        observations.operations.push("submit");
        json(response, 201, task(false, "submitted"));
      } else if (request.method === "PUT" && url.pathname === `/v1/tasks/${taskUid}/inputs`) {
        payload = await uploadedPayload(await requestBody(request));
        observations.uploaded = true;
        observations.operations.push("upload-inputs");
        response.writeHead(204).end();
      } else if (request.method === "POST" && url.pathname === `/v1/tasks/${taskUid}/execute`) {
        observations.executed = true;
        observations.operations.push("execute");
        json(response, 202, task(false, "running"));
      } else if (request.method === "GET" && url.pathname === `/v1/tasks/${taskUid}`) {
        observations.polled = true;
        observations.operations.push("poll");
        json(
          response,
          200,
          options.terminalFailureReason === undefined
            ? task(observations.finalized, "succeeded")
            : task(observations.finalized, "failed", options.terminalFailureReason),
        );
      } else if (request.method === "GET" && url.pathname === `/v1/tasks/${taskUid}/outputs`) {
        if (!payload) throw new Error("mock output requested before input upload");
        observations.downloaded = true;
        observations.operations.push("download-outputs");
        response.writeHead(200, { "content-type": "application/x-tar" });
        response.end(await outputArchive(payload));
      } else if (request.method === "DELETE" && url.pathname === `/v1/tasks/${taskUid}`) {
        if (options.finalizationMarker) {
          await writeFile(options.finalizationMarker, `${taskUid}\n`, "utf8");
        }
        observations.finalized = true;
        observations.operations.push("finalize");
        json(
          response,
          202,
          options.terminalFailureReason === undefined
            ? task(true, "succeeded")
            : task(true, "failed", options.terminalFailureReason),
        );
      } else {
        json(response, 404, { message: "not found" });
      }
    })().catch((error: unknown) => {
      json(response, 500, { message: error instanceof Error ? error.message : String(error) });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock server has no TCP address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    observations,
    close: async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const portFile = process.argv[2];
  const finalizationMarker = process.argv[3];
  if (!portFile) throw new Error("mock server requires a port-file argument");
  if (!finalizationMarker) throw new Error("mock server requires a finalization-marker argument");
  const mock = await startMockSteward({
    finalizationMarker,
    acceptExternalGithubOidcToken: true,
  });
  await writeFile(portFile, new URL(mock.url).port, "utf8");
  const stop = () => void mock.close().then(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
