import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createStewardFetch } from "../src/transport.ts";

const execFileAsync = promisify(execFile);
const proxyVariables = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

async function listen(server: HttpServer | HttpsServer): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server has no port");
  return address.port;
}

async function close(server: HttpServer | HttpsServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function withProxyEnvironment(
  values: Partial<Record<(typeof proxyVariables)[number], string>>,
  run: () => Promise<void>,
): Promise<void> {
  const saved = Object.fromEntries(proxyVariables.map((name) => [name, process.env[name]]));
  try {
    for (const name of proxyVariables) delete process.env[name];
    Object.assign(process.env, values);
    await run();
  } finally {
    for (const name of proxyVariables) {
      const value = saved[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("HTTP_PROXY routes action transport and NO_PROXY bypasses it", async () => {
  const origin = createHttpServer((_request, response) => response.end("direct"));
  let tunnels = 0;
  const proxy = createHttpServer((_request, response) => response.writeHead(502).end());
  proxy.on("connect", (requestMessage, client, head) => {
    const [host, rawPort] = (requestMessage.url ?? "").split(":");
    const port = Number(rawPort);
    if (!host || !Number.isInteger(port)) {
      client.destroy();
      return;
    }
    const upstream = connect(port, host, () => {
      tunnels += 1;
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.once("error", () => client.destroy());
  });
  const originPort = await listen(origin);
  const proxyPort = await listen(proxy);
  try {
    await withProxyEnvironment(
      { HTTP_PROXY: `http://127.0.0.1:${proxyPort}`, NO_PROXY: "" },
      async () => {
        const fetchImplementation = await createStewardFetch();
        try {
          const response = await fetchImplementation(`http://127.0.0.1:${originPort}`);
          assert.equal(await response.text(), "direct");
        } finally {
          await fetchImplementation.close();
        }
      },
    );
    assert.equal(tunnels, 1);
    await withProxyEnvironment(
      { HTTP_PROXY: `http://127.0.0.1:${proxyPort}`, NO_PROXY: "127.0.0.1" },
      async () => {
        const fetchImplementation = await createStewardFetch();
        try {
          const response = await fetchImplementation(`http://127.0.0.1:${originPort}`);
          assert.equal(await response.text(), "direct");
        } finally {
          await fetchImplementation.close();
        }
      },
    );
    assert.equal(tunnels, 1, "NO_PROXY must bypass the proxy");
  } finally {
    await Promise.all([close(origin), close(proxy)]);
  }
});

test("HTTPS_PROXY tunnels private-CA action transport without disabling TLS validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-proxy-"));
  const caCertificate = join(root, "ca.pem");
  const caKey = join(root, "ca-key.pem");
  const serverCertificate = join(root, "server.pem");
  const serverKey = join(root, "server-key.pem");
  const request = join(root, "server.csr");
  const extensions = join(root, "server-extensions.cnf");
  await execFileAsync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1",
    "-subj", "/CN=proxy test CA", "-addext", "basicConstraints=critical,CA:TRUE",
    "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-keyout", caKey, "-out", caCertificate,
  ]);
  await writeFile(
    extensions,
    "subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n",
    "utf8",
  );
  await execFileAsync("openssl", [
    "req", "-newkey", "rsa:2048", "-nodes", "-sha256", "-subj", "/CN=127.0.0.1",
    "-keyout", serverKey, "-out", request,
  ]);
  await execFileAsync("openssl", [
    "x509", "-req", "-sha256", "-days", "1", "-in", request, "-CA", caCertificate,
    "-CAkey", caKey, "-CAcreateserial", "-extfile", extensions, "-out", serverCertificate,
  ]);

  const origin = createHttpsServer(
    { cert: await readFile(serverCertificate), key: await readFile(serverKey) },
    (_request, response) => response.end("secure"),
  );
  let tunnels = 0;
  const proxy = createHttpServer((_request, response) => response.writeHead(502).end());
  proxy.on("connect", (requestMessage, client, head) => {
    const [host, rawPort] = (requestMessage.url ?? "").split(":");
    const port = Number(rawPort);
    if (!host || !Number.isInteger(port)) {
      client.destroy();
      return;
    }
    const upstream = connect(port, host, () => {
      tunnels += 1;
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.once("error", () => client.destroy());
  });

  const originPort = await listen(origin);
  const proxyPort = await listen(proxy);
  try {
    await withProxyEnvironment(
      { HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`, NO_PROXY: "" },
      async () => {
        const fetchImplementation = await createStewardFetch(caCertificate);
        try {
          const response = await fetchImplementation(`https://127.0.0.1:${originPort}`);
          assert.equal(await response.text(), "secure");
        } finally {
          await fetchImplementation.close();
        }
      },
    );
    assert.equal(tunnels, 1);
  } finally {
    await Promise.all([close(origin), close(proxy)]);
    await rm(root, { recursive: true, force: true });
  }
});
