import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { RequestListener } from "node:http";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import tar from "tar-stream";
import { createInputArchive } from "../src/archive.ts";
import { identityExchangeTokenProvider, STEWARD_TASK_API_AUDIENCE } from "../src/identity-exchange.ts";
import { StewardClient, StewardRequestFailure, type Task } from "../src/steward-client.ts";
import { createStewardFetch } from "../src/transport.ts";

const execFileAsync = promisify(execFile);

const task: Task = {
  taskUid: "2f9f6ade-261d-4090-9532-9e157b59db2e",
  runtimeUid: "runtime-uid-1",
  phase: "succeeded",
  runtimeOwnership: "provisioned",
  finalized: false,
  deltas: [],
};

interface CertificateAuthority {
  certificate: string;
  key: string;
}

async function createCertificateAuthority(root: string, name: string): Promise<CertificateAuthority> {
  const certificate = join(root, `${name}-ca.pem`);
  const key = join(root, `${name}-ca-key.pem`);
  await execFileAsync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-days",
    "1",
    "-subj",
    `/CN=${name} test CA`,
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
    "-keyout",
    key,
    "-out",
    certificate,
  ]);
  return { certificate, key };
}

async function issueServerCertificate(
  root: string,
  authority: CertificateAuthority,
  name: string,
  subjectAlternativeName: string,
): Promise<{ certificate: string; key: string }> {
  const certificate = join(root, `${name}.pem`);
  const request = join(root, `${name}.csr`);
  const key = join(root, `${name}-key.pem`);
  const extensions = join(root, `${name}-extensions.cnf`);
  await writeFile(
    extensions,
    `subjectAltName=${subjectAlternativeName}\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n`,
    "utf8",
  );
  await execFileAsync("openssl", [
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-subj",
    `/CN=${name}`,
    "-keyout",
    key,
    "-out",
    request,
  ]);
  await execFileAsync("openssl", [
    "x509",
    "-req",
    "-sha256",
    "-days",
    "1",
    "-in",
    request,
    "-CA",
    authority.certificate,
    "-CAkey",
    authority.key,
    "-CAcreateserial",
    "-extfile",
    extensions,
    "-out",
    certificate,
  ]);
  return { certificate, key };
}

async function startTlsServer(
  certificatePath: string,
  keyPath: string,
  listener?: RequestListener,
): Promise<{ server: Server; url: string }> {
  const server = createServer(
    { cert: await readFile(certificatePath), key: await readFile(keyPath) },
    listener ??
      ((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(task));
      }),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TLS test server has no address");
  return { server, url: `https://127.0.0.1:${address.port}` };
}

async function collectRequest(request: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function readArchiveFiles(archive: Buffer): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const extract = tar.extract();
  extract.on("entry", (header, stream, next) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => {
      if (header.type === "file") files.set(header.name, Buffer.concat(chunks));
      next();
    });
    stream.resume();
  });
  await new Promise<void>((resolve, reject) => {
    extract.once("finish", resolve);
    extract.once("error", reject);
    extract.end(archive);
  });
  return files;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

test("a trusted private CA succeeds while a wrong CA and hostname mismatch fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-tls-"));
  const authority = await createCertificateAuthority(root, "trusted");
  const wrongAuthority = await createCertificateAuthority(root, "wrong");
  const matching = await issueServerCertificate(root, authority, "matching", "IP:127.0.0.1");
  const mismatched = await issueServerCertificate(root, authority, "mismatched", "DNS:elsewhere.invalid");
  const trustedServer = await startTlsServer(matching.certificate, matching.key);
  const mismatchServer = await startTlsServer(mismatched.certificate, mismatched.key);
  try {
    const trustedClient = new StewardClient({
      baseUrl: trustedServer.url,
      getToken: async () => "token",
      fetch: await createStewardFetch(authority.certificate),
      maxAttempts: 1,
    });
    assert.deepEqual(await trustedClient.getTask(task.taskUid), task);

    const wrongCaClient = new StewardClient({
      baseUrl: trustedServer.url,
      getToken: async () => "token",
      fetch: await createStewardFetch(wrongAuthority.certificate),
      maxAttempts: 1,
    });
    await assert.rejects(wrongCaClient.getTask(task.taskUid), (error: unknown) => {
      assert.ok(error instanceof StewardRequestFailure);
      assert.equal(error.stage, "poll");
      assert.equal(error.category, "transport");
      return true;
    });

    const hostnameClient = new StewardClient({
      baseUrl: mismatchServer.url,
      getToken: async () => "token",
      fetch: await createStewardFetch(authority.certificate),
      maxAttempts: 1,
    });
    await assert.rejects(hostnameClient.getTask(task.taskUid), (error: unknown) => {
      assert.ok(error instanceof StewardRequestFailure);
      assert.equal(error.stage, "poll");
      assert.equal(error.category, "transport");
      return true;
    });
  } finally {
    await Promise.all([close(trustedServer.server), close(mismatchServer.server)]);
    await rm(root, { recursive: true, force: true });
  }
});

test("adding a private CA preserves the process default trust store", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-additive-ca-"));
  const defaultAuthority = await createCertificateAuthority(root, "default");
  const configuredAuthority = await createCertificateAuthority(root, "configured");
  const matching = await issueServerCertificate(
    root,
    defaultAuthority,
    "default-trusted",
    "IP:127.0.0.1",
  );
  const tlsServer = await startTlsServer(
    matching.certificate,
    matching.key,
    (_request, response) => response.writeHead(200).end("ok"),
  );
  try {
    const child = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("support/additive-ca-child.ts", import.meta.url)),
        tlsServer.url,
        configuredAuthority.certificate,
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: { ...process.env, NODE_EXTRA_CA_CERTS: defaultAuthority.certificate },
      },
    );
    assert.equal(child.stdout, "ok");
  } finally {
    await close(tlsServer.server);
    await rm(root, { recursive: true, force: true });
  }
});

test("the explicit exchange URL, audience, and CA-file compatibility path remains executable", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-explicit-auth-"));
  const authority = await createCertificateAuthority(root, "explicit-auth");
  const matching = await issueServerCertificate(root, authority, "explicit-auth", "IP:127.0.0.1");
  const now = 1_800_000_000;
  const sourceToken = jwt({ aud: "explicit-customer-audience" });
  const stewardToken = jwt({ aud: STEWARD_TASK_API_AUDIENCE, iat: now, exp: now + 120 });
  let exchangeRequests = 0;
  const tlsServer = await startTlsServer(
    matching.certificate,
    matching.key,
    (request, response) => {
      exchangeRequests += 1;
      assert.equal(request.url, "/v1/exchange");
      assert.equal(request.headers.authorization, `Bearer ${sourceToken}`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ access_token: stewardToken, expires_in: 120, token_type: "Bearer" }));
    },
  );
  try {
    const provider = identityExchangeTokenProvider(
      {
        ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example/id",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
      },
      `${tlsServer.url}/v1/exchange`,
      async (input) => {
        assert.equal(new URL(String(input)).searchParams.get("audience"), "explicit-customer-audience");
        return new Response(JSON.stringify({ value: sourceToken }), {
          headers: { "content-type": "application/json" },
        });
      },
      () => now,
      "explicit-customer-audience",
      await createStewardFetch(authority.certificate),
    );
    assert.equal(await provider(), stewardToken);
    assert.equal(exchangeRequests, 1);
  } finally {
    await close(tlsServer.server);
    await rm(root, { recursive: true, force: true });
  }
});

test("private-CA uploads stream real input archives and recreate them for retries", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-tls-upload-"));
  const workspace = join(root, "workspace");
  const authority = await createCertificateAuthority(root, "upload");
  const matching = await issueServerCertificate(root, authority, "matching", "IP:127.0.0.1");
  const received: Buffer[] = [];
  let resolveServerError: ((error: unknown) => void) | undefined;
  const serverError = new Promise<unknown>((resolve) => {
    resolveServerError = resolve;
  });
  const tlsServer = await startTlsServer(
    matching.certificate,
    matching.key,
    (request, response) => {
      void collectRequest(request)
        .then((body) => {
          received.push(body);
          response.writeHead(received.length === 1 ? 503 : 204);
          response.end();
        })
        .catch((error: unknown) => {
          resolveServerError?.(error);
          response.destroy();
        });
    },
  );
  try {
    await mkdir(join(workspace, "in"), { recursive: true });
    const payload = Buffer.from("private CA archive payload\n", "utf8");
    await writeFile(join(workspace, "in", "payload.bin"), payload);
    let archiveCreations = 0;
    const client = new StewardClient({
      baseUrl: tlsServer.url,
      getToken: async () => "token",
      fetch: await createStewardFetch(authority.certificate),
      sleep: async () => undefined,
      maxAttempts: 2,
    });

    await Promise.race([
      client.uploadTaskInputs(task.taskUid, async () => {
        archiveCreations += 1;
        return createInputArchive(workspace, ["in"]);
      }),
      serverError.then((error) => Promise.reject(error)),
    ]);

    assert.equal(archiveCreations, 2);
    assert.equal(received.length, 2);
    assert.deepEqual(received[0], received[1]);
    const files = await readArchiveFiles(received[1] ?? Buffer.alloc(0));
    assert.deepEqual(files.get("in/payload.bin"), payload);
  } finally {
    await close(tlsServer.server);
    await rm(root, { recursive: true, force: true });
  }
});

test("a private-CA 204 response does not keep a failed action process alive", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-tls-liveness-"));
  const authority = await createCertificateAuthority(root, "liveness");
  const matching = await issueServerCertificate(root, authority, "matching", "IP:127.0.0.1");
  const tlsServer = await startTlsServer(
    matching.certificate,
    matching.key,
    (request, response) => {
      void collectRequest(request)
        .then(() => response.writeHead(204).end())
        .catch(() => response.destroy());
    },
  );
  let timeout: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("support/private-ca-204-child.ts", import.meta.url)),
        tlsServer.url,
        authority.certificate,
      ],
      { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const result = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      },
    );
    timeout = setTimeout(() => {
      timedOut = true;
      // Release the deliberately external server-side connection so a broken
      // child can still terminate without process.exit() or a kill signal.
      tlsServer.server.closeAllConnections();
    }, 3_000);
    const exited = await result;

    assert.equal(timedOut, false, "child retained the private-CA response socket");
    assert.equal(exited.code, 23);
    assert.equal(exited.signal, null);
    assert.match(stderr, /deliberate post-upload failure/u);
  } finally {
    if (timeout) clearTimeout(timeout);
    await close(tlsServer.server);
    await rm(root, { recursive: true, force: true });
  }
});

test("missing and invalid CA files and plaintext remote endpoints fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-ca-invalid-"));
  const missing = join(root, "missing.pem");
  const invalid = join(root, "invalid.pem");
  try {
    await assert.rejects(createStewardFetch(missing), /CA certificate file could not be read/);
    await writeFile(invalid, "not a certificate", "utf8");
    await assert.rejects(createStewardFetch(invalid), /valid CA certificate/);
    assert.throws(
      () =>
        new StewardClient({
          baseUrl: "http://steward.internal.example",
          getToken: async () => "token",
        }),
      /must use HTTPS/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
