import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import tar from "tar-stream";

const taskUid = "2f9f6ade-261d-4090-9532-9e157b59db2e";
const runtimeUid = "mock-runtime-uid";
const identityToken = "header.payload.signature";

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
  };
  close: () => Promise<void>;
}

interface MockStewardOptions {
  finalizationMarker?: string;
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

function task(finalized: boolean, phase: "submitted" | "running" | "succeeded") {
  return {
    taskUid,
    runtimeUid,
    phase,
    runtimeOwnership: "provisioned",
    finalized,
    deltas: [],
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
  const observations = {
    created: false,
    uploaded: false,
    executed: false,
    polled: false,
    downloaded: false,
    finalized: false,
    oidcRequests: 0,
  };
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
        if (url.searchParams.get("audience") !== "steward-task-api") {
          json(response, 400, { message: "invalid OIDC audience" });
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
        json(response, 201, task(false, "submitted"));
      } else if (request.method === "PUT" && url.pathname === `/v1/tasks/${taskUid}/inputs`) {
        payload = await uploadedPayload(await requestBody(request));
        observations.uploaded = true;
        response.writeHead(204).end();
      } else if (request.method === "POST" && url.pathname === `/v1/tasks/${taskUid}/execute`) {
        observations.executed = true;
        json(response, 202, task(false, "running"));
      } else if (request.method === "GET" && url.pathname === `/v1/tasks/${taskUid}`) {
        observations.polled = true;
        json(response, 200, task(observations.finalized, "succeeded"));
      } else if (request.method === "GET" && url.pathname === `/v1/tasks/${taskUid}/outputs`) {
        if (!payload) throw new Error("mock output requested before input upload");
        observations.downloaded = true;
        response.writeHead(200, { "content-type": "application/x-tar" });
        response.end(await outputArchive(payload));
      } else if (request.method === "DELETE" && url.pathname === `/v1/tasks/${taskUid}`) {
        if (options.finalizationMarker) {
          await writeFile(options.finalizationMarker, `${taskUid}\n`, "utf8");
        }
        observations.finalized = true;
        json(response, 202, task(true, "succeeded"));
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
  const mock = await startMockSteward({ finalizationMarker });
  await writeFile(portFile, new URL(mock.url).port, "utf8");
  const stop = () => void mock.close().then(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
