import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { startMockSteward } from "./support/mock-steward.ts";

test("the checked-in bundle round-trips a file through the mock Steward API", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "steward-run-bundle-"));
  const outputFile = join(workspace, "github-output");
  const mock = await startMockSteward();
  try {
    await mkdir(join(workspace, "in"));
    await writeFile(join(workspace, "in", "payload.txt"), "round-trip\n");
    await writeFile(outputFile, "");
    const child = spawn(process.execPath, ["dist/index.cjs"], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        ACTIONS_ID_TOKEN_REQUEST_URL: `${mock.url}/oidc?api-version=1`,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
        GITHUB_JOB: "agent",
        GITHUB_OUTPUT: outputFile,
        GITHUB_REPOSITORY: "apelogic-ai/example",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_RUN_ID: "123",
        GITHUB_WORKSPACE: workspace,
        STEWARD_RUN_API_URL: mock.url,
        STEWARD_RUN_CODING_AGENT_RUNTIME: "claude-code@2.1.220",
        STEWARD_RUN_INPUTS: "in",
        STEWARD_RUN_OIDC_AUDIENCE: "steward-test",
        STEWARD_RUN_OUTPUTS: "results",
        STEWARD_RUN_WORKFLOW: "cve-triage",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += String(chunk)));
    const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    assert.equal(code, 0, stderr);
    assert.equal(await readFile(join(workspace, "results", "report.txt"), "utf8"), "round-trip\n");
    assert.match(await readFile(outputFile, "utf8"), /status=succeeded/);
    assert.ok(mock.observations.oidcRequests >= 5);
    assert.equal(mock.observations.finalized, true);
  } finally {
    await mock.close();
    await rm(workspace, { recursive: true, force: true });
  }
});
