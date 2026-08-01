import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import tar from "tar-stream";

const runUid = "2f9f6ade-261d-4090-9532-9e157b59db2e";
const runtimeUid = "mock-runtime-uid";
const identityToken = "header.payload.signature";

export interface MockSteward {
  url: string;
  observations: {
    finalized: boolean;
    oidcRequests: number;
  };
  close: () => Promise<void>;
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
      if (header.name === "in/payload.txt") payload = Buffer.concat(chunks);
      next();
    })().catch((error: unknown) => next(error as Error));
  });
  await new Promise<void>((resolve, reject) => {
    extract.once("finish", resolve);
    extract.once("error", reject);
    extract.end(body);
  });
  if (!payload) throw new Error("mock input archive omitted in/payload.txt");
  return payload;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function run(finalized: boolean, phase: "accepted" | "running" | "succeeded") {
  return {
    runUid,
    runtimeUid,
    phase,
    runtimeOwnership: "provisioned",
    finalized,
  };
}

async function outputArchive(payload: Buffer): Promise<Buffer> {
  const pack = tar.pack();
  pack.entry({ name: "results", type: "directory" });
  pack.entry({ name: "results/report.txt" }, payload);
  pack.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of pack) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function startMockSteward(): Promise<MockSteward> {
  const observations = { finalized: false, oidcRequests: 0 };
  let payload: Buffer<ArrayBufferLike> = Buffer.from("missing input\n");
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/oidc") {
        observations.oidcRequests += 1;
        if (request.headers.authorization !== "Bearer request-secret") {
          json(response, 401, { message: "invalid request token" });
          return;
        }
        json(response, 200, { value: identityToken });
        return;
      }
      const bearer = request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
      if (!/^[^.]+\.[^.]+\.[^.]+$/u.test(bearer)) {
        json(response, 401, { message: "invalid identity token" });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/runs") {
        json(response, 201, run(false, "accepted"));
      } else if (request.method === "PUT" && url.pathname === `/v1/runs/${runUid}/inputs`) {
        payload = await uploadedPayload(await requestBody(request));
        response.writeHead(204).end();
      } else if (request.method === "POST" && url.pathname === `/v1/runs/${runUid}/execute`) {
        json(response, 202, run(false, "running"));
      } else if (request.method === "GET" && url.pathname === `/v1/runs/${runUid}`) {
        json(response, 200, run(observations.finalized, "succeeded"));
      } else if (request.method === "GET" && url.pathname === `/v1/runs/${runUid}/outputs`) {
        response.writeHead(200, { "content-type": "application/x-tar" });
        response.end(await outputArchive(payload));
      } else if (request.method === "DELETE" && url.pathname === `/v1/runs/${runUid}`) {
        observations.finalized = true;
        json(response, 202, run(true, "succeeded"));
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
  if (!portFile) throw new Error("mock server requires a port-file argument");
  const mock = await startMockSteward();
  await writeFile(portFile, new URL(mock.url).port, "utf8");
  const stop = () => void mock.close().then(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
