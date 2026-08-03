import { readFile } from "node:fs/promises";

const targets = ["action.yml", "Dockerfile", "dist/index.cjs"];
const forbidden = [
  "GITHUB_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "claude install",
  "npm install -g @anthropic-ai/claude-code",
];

for (const target of targets) {
  const source = await readFile(new URL(`../${target}`, import.meta.url), "utf8");
  for (const marker of forbidden) {
    if (source.toLowerCase().includes(marker.toLowerCase())) {
      throw new Error(`${target} violates the thin-shell boundary (${marker})`);
    }
  }
}

const action = await readFile(new URL("../action.yml", import.meta.url), "utf8");
if (!action.includes("dist/index.cjs") || !action.includes("steward-api-url")) {
  throw new Error("action.yml does not route work exclusively through the Steward client");
}

process.stdout.write("thin-shell check passed\n");
