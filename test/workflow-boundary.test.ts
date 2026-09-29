import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkWorkflowBoundary } from "../scripts/check-workflow-boundary.mjs";

test("workflow boundary enumerates every YAML workflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "steward-run-workflows-"));
  try {
    await writeFile(join(root, "first.yml"), "name: first\n");
    await writeFile(join(root, "second.YAML"), "name: second\n");
    await writeFile(join(root, "ignored.txt"), "aws ecr\n");
    assert.deepEqual(await checkWorkflowBoundary(root), ["first.yml", "second.YAML"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const [name, planted] of [
  ["AWS repository variable", "${{ vars.AWS_RELEASE_ROLE }}"],
  ["ECR secret", "${{ secrets.ECR_PASSWORD }}"],
  ["mixed-case AWS action", "uses: AWS-Actions/configure-aws-credentials@deadbeef"],
  ["Amazon ECR login action", "uses: vendor/Amazon-ECR-Login@deadbeef"],
  ["AWS ECR command", "run: AwS   EcR get-login-password"],
] as const) {
  test(`workflow boundary rejects ${name}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "steward-run-workflows-"));
    try {
      await writeFile(join(root, "safe.yml"), "name: safe\n");
      await writeFile(join(root, "planted.yaml"), `${planted}\n`);
      await assert.rejects(checkWorkflowBoundary(root), /planted\.yaml/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
