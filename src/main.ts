import { readActionConfig } from "./config.js";

export async function main(): Promise<void> {
  readActionConfig(process.env);
  throw new Error("Steward run lifecycle is not implemented yet");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`steward-run: ${message}\n`);
    process.exitCode = 1;
  });
}

