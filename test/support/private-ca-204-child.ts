import { createStewardFetch } from "../../src/transport.ts";

async function run(): Promise<void> {
  const url = process.argv[2];
  const caCertificateFile = process.argv[3];
  if (!url || !caCertificateFile) throw new Error("missing private-CA liveness fixture arguments");

  const stewardFetch = await createStewardFetch(caCertificateFile);
  const response = await stewardFetch(url, {
    method: "PUT",
    body: "private CA liveness payload",
  });
  if (response.status !== 204) throw new Error("private-CA liveness fixture expected HTTP 204");
  throw new Error("deliberate post-upload failure");
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown fixture failure";
  process.stderr.write(`${message}\n`);
  process.exitCode = 23;
});
