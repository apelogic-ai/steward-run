import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the ARC image pins runner and Node images and remains a thin shell", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(
    dockerfile,
    /FROM node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS node-runtime/,
  );
  assert.match(
    dockerfile,
    /FROM ghcr\.io\/actions\/actions-runner:2\.334\.0@sha256:b6614fce332517f74d0a76e7c762fb08e4f2ff13dcf333183397c8a5725b6e8e/,
  );
  assert.match(dockerfile, /COPY --from=node-runtime \/usr\/local\/bin\/node/);
  assert.match(dockerfile, /USER runner/);
  assert.match(dockerfile, /rm -f \/usr\/bin\/containerd \/usr\/bin\/containerd-shim-runc-v2 \/usr\/bin\/ctr/);
  assert.match(dockerfile, /rm -rf \/home\/runner\/externals\/node20\/lib\/node_modules\/npm/);
  assert.doesNotMatch(dockerfile, /claude|codex|api[_-]?key|credential|secret/iu);
  assert.doesNotMatch(dockerfile, /ENTRYPOINT|CMD/u);
});

test("the thin-shell security check is a required build gate", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.match(packageJson.scripts.check ?? "", /check:thin-shell/);
  assert.equal(packageJson.scripts["check:thin-shell"], "node scripts/check-thin-shell.mjs");
});
