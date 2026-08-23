import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function testJwt(nowSeconds: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ iat: nowSeconds, exp: nowSeconds + 300 })}.test-signature-secret`;
}

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

test("submit diagnostics never disclose a file-backed bearer or response body", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "steward-run-submit-failure-"));
  const outputFile = join(workspace, "github-output");
  const summaryFile = join(workspace, "github-summary");
  const bearerFile = join(workspace, "projected-token.jwt");
  const bearer = testJwt(Math.floor(Date.now() / 1_000));
  const secretBody = "private-Steward-response-body";
  const server = createServer((_request, response) => {
    response.writeHead(401, {
      "content-type": "application/json",
      "x-request-id": "request-local-401",
    });
    response.end(secretBody);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await mkdir(join(workspace, "in"));
    await writeFile(join(workspace, "in", "request.txt"), "bounded request");
    await writeFile(outputFile, "");
    await writeFile(summaryFile, "");
    await writeFile(bearerFile, bearer);

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
        STEWARD_RUN_API_URL: `http://127.0.0.1:${address.port}`,
        STEWARD_RUN_BEARER_TOKEN_FILE: bearerFile,
        STEWARD_RUN_CODING_AGENT_RUNTIME: "claude-code@2.1.220",
        STEWARD_RUN_INPUTS: "in",
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
    const outputs = await readFile(outputFile, "utf8");
    const rendered = `${stdout}\n${stderr}\n${summary}\n${outputs}`;

    assert.equal(code, 1);
    assert.match(rendered, /failure-category=authentication/u);
    assert.match(
      rendered,
      /steward-run\.request-failure\/v1 stage=submit category=authentication status=401 correlation-id=request-local-401/u,
    );
    assert.equal(outputs, "");
    await assert.rejects(access(join(workspace, "out")));
    for (const forbidden of [bearer, "test-signature-secret", secretBody, "projected-token.jwt"]) {
      assert.doesNotMatch(rendered, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(workspace, { recursive: true, force: true });
  }
});
