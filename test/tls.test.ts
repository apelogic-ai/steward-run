import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { StewardClient, type Task } from "../src/steward-client.ts";
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
): Promise<{ server: Server; url: string }> {
  const server = createServer(
    { cert: await readFile(certificatePath), key: await readFile(keyPath) },
    (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(task));
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TLS test server has no address");
  return { server, url: `https://127.0.0.1:${address.port}` };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
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
    await assert.rejects(wrongCaClient.getTask(task.taskUid), /failed after retries/);

    const hostnameClient = new StewardClient({
      baseUrl: mismatchServer.url,
      getToken: async () => "token",
      fetch: await createStewardFetch(authority.certificate),
      maxAttempts: 1,
    });
    await assert.rejects(hostnameClient.getTask(task.taskUid), /failed after retries/);
  } finally {
    await Promise.all([close(trustedServer.server), close(mismatchServer.server)]);
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
