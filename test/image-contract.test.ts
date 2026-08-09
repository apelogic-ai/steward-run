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
    /FROM ghcr\.io\/actions\/actions-runner:2\.336\.0@sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda/,
  );
  assert.match(dockerfile, /COPY --from=node-runtime \/usr\/local\/bin\/node/);
  assert.match(dockerfile, /USER runner/);
  assert.match(dockerfile, /apt-get upgrade -y/);
  assert.match(dockerfile, /apt-get purge -y curl libcurl4t64/);
  assert.match(dockerfile, /rm -f \/usr\/bin\/containerd \/usr\/bin\/containerd-shim-runc-v2 \/usr\/bin\/ctr/);
  assert.match(dockerfile, /\/usr\/bin\/docker \/usr\/bin\/docker-init \/usr\/bin\/docker-proxy/);
  assert.match(dockerfile, /\/usr\/bin\/dockerd \/usr\/bin\/runc/);
  assert.match(dockerfile, /rm -rf \/usr\/local\/lib\/docker/);
  assert.match(dockerfile, /\/home\/runner\/externals\/node20\/lib\/node_modules\/npm/);
  assert.doesNotMatch(dockerfile, /claude|codex|api[_-]?key|credential|secret/iu);
  assert.doesNotMatch(dockerfile, /ENTRYPOINT|CMD/u);
});

test("the package metadata identifies the in-cluster integration release", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  const packageLock = JSON.parse(
    await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  ) as { version: string; packages: Record<string, { version?: string }> };

  assert.equal(packageJson.version, "0.3.5");
  assert.equal(packageLock.version, "0.3.5");
  assert.equal(packageLock.packages[""]?.version, "0.3.5");
});

test("the thin-shell security check is a required build gate", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.match(packageJson.scripts.check ?? "", /check:thin-shell/);
  assert.equal(packageJson.scripts["check:thin-shell"], "node scripts/check-thin-shell.mjs");
});
