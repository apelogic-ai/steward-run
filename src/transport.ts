import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getCACertificates } from "node:tls";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import type { FetchLike } from "./oidc.js";

export type CloseableFetch = FetchLike & { close: () => Promise<void> };

const certificatePattern = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu;

async function trustedCaBundle(path: string): Promise<string[]> {
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
  return certificates;
}

export async function createStewardFetch(caCertificateFile?: string): Promise<CloseableFetch> {
  const certificates = caCertificateFile
    ? [...getCACertificates("default"), ...(await trustedCaBundle(caCertificateFile))]
    : undefined;
  const dispatcher = new EnvHttpProxyAgent(
    certificates
      ? {
          connect: { ca: certificates, rejectUnauthorized: true },
          proxyTls: { ca: certificates, rejectUnauthorized: true },
          requestTls: { ca: certificates, rejectUnauthorized: true },
        }
      : undefined,
  );

  const fetchImplementation: FetchLike = async (input, init = {}) =>
    (await undiciFetch(
      input as Parameters<typeof undiciFetch>[0],
      {
        ...init,
        dispatcher,
      } as Parameters<typeof undiciFetch>[1],
    )) as unknown as Response;
  return Object.assign(fetchImplementation, { close: () => dispatcher.close() });
}
