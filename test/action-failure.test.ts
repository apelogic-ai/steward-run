import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("the action publishes sanitized failure metadata and never raw failure data", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "steward-run-failure-"));
  const outputFile = join(workspace, "github-output");
  const summaryFile = join(workspace, "github-summary");
  try {
    await writeFile(outputFile, "");
    await writeFile(summaryFile, "");
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        GITHUB_JOB: "agent",
        GITHUB_OUTPUT: outputFile,
        GITHUB_REPOSITORY: "apelogic-ai/example",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_RUN_ID: "123",
        GITHUB_STEP_SUMMARY: summaryFile,
        GITHUB_WORKSPACE: workspace,
        STEWARD_RUN_API_URL: "http://127.0.0.1:9",
        STEWARD_RUN_BEARER_TOKEN_FILE: "/not-used/private-credential.jwt",
        STEWARD_RUN_CODING_AGENT_RUNTIME: "claude-code@2.1.220",
        STEWARD_RUN_INPUTS: "missing-secret-value",
        STEWARD_RUN_OUTPUTS: "out",
        STEWARD_RUN_WORKFLOW: "copy-smoke",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += String(chunk)));
    const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    const summary = await readFile(summaryFile, "utf8");

    assert.equal(code, 1);
    assert.equal(
      stdout,
      "::error title=Steward governed Task failed::steward-run.failure/v1 phase=unavailable failure-category=input-output cleanup-category=not-required\n",
    );
    assert.match(
      stderr,
      /steward-run: Steward governed Task failed \(phase=unavailable, failure-category=input-output, cleanup-category=not-required\)\n$/u,
    );
    assert.match(summary, /\| steward-run\.failure\/v1 \| unavailable \| input-output \| not-required \|/u);
    for (const forbidden of ["missing-secret-value", "private-credential", "declared input"] ) {
      assert.doesNotMatch(`${stdout}\n${stderr}\n${summary}`, new RegExp(forbidden, "u"));
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
