import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import type { FetchLike } from "./oidc.js";

const certificatePattern = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu;

async function trustedCaBundle(path: string): Promise<string> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    throw new Error("Steward CA certificate file could not be read");
  }
  const certificates = source.match(certificatePattern) ?? [];
  const remainder = source.replace(certificatePattern, "").trim();
  try {
    if (!certificates.length || remainder) throw new Error("invalid bundle");
    for (const pem of certificates) {
      if (!new X509Certificate(pem).ca) throw new Error("certificate is not a CA");
    }
  } catch {
    throw new Error("Steward CA certificate file does not contain a valid CA certificate");
  }
  return certificates.join("\n");
}

function headersFrom(response: IncomingMessage): Headers {
  const headers = new Headers();
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index];
    const value = response.rawHeaders[index + 1];
    if (name && value !== undefined) headers.append(name, value);
  }
  return headers;
}

function writeBody(request: ReturnType<typeof httpsRequest>, body: unknown): void {
  if (body === undefined || body === null) {
    request.end();
  } else if (
    typeof body === "string" ||
    body instanceof Uint8Array ||
    body instanceof ArrayBuffer
  ) {
    request.end(body);
  } else if (body instanceof URLSearchParams) {
    request.end(body.toString());
  } else if (body instanceof Readable) {
    body.pipe(request);
  } else if (typeof body === "object" && "getReader" in body) {
    Readable.fromWeb(body as import("node:stream/web").ReadableStream).pipe(request);
  } else {
    request.destroy(new Error("unsupported Steward request body"));
  }
}

function privateCaFetch(ca: string): FetchLike {
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init.method ?? (input instanceof Request ? input.method : "GET");
    const requestHeaders = new Headers(
      init.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    return new Promise<Response>((resolve, reject) => {
      const handleResponse = (response: IncomingMessage): void => {
        const status = response.statusCode ?? 500;
        const noBody = method === "HEAD" || status === 204 || status === 205 || status === 304;
        const body = noBody
          ? null
          : (Readable.toWeb(response) as import("node:stream/web").ReadableStream);
        resolve(
          new Response(body, {
            status,
            ...(response.statusMessage ? { statusText: response.statusMessage } : {}),
            headers: headersFrom(response),
          }),
        );
      };
      const outgoingHeaders: Record<string, string> = {};
      requestHeaders.forEach((value, name) => {
        outgoingHeaders[name] = value;
      });
      const options = {
        method,
        headers: outgoingHeaders,
      };
      const request =
        url.protocol === "https:"
          ? httpsRequest(url, { ...options, ca, rejectUnauthorized: true }, handleResponse)
          : url.protocol === "http:"
            ? httpRequest(url, options, handleResponse)
            : undefined;
      if (!request) {
        reject(new Error("unsupported Steward URL protocol"));
        return;
      }
      request.once("error", reject);
      writeBody(request, init.body ?? (input instanceof Request ? input.body : undefined));
    });
  };
}

export async function createStewardFetch(caCertificateFile?: string): Promise<FetchLike> {
  if (!caCertificateFile) return fetch;
  return privateCaFetch(await trustedCaBundle(caCertificateFile));
}
