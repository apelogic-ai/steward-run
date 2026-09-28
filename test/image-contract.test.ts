import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

test("the ARC image pins runner and Node images and remains a thin shell", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(
    dockerfile,
    /FROM node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS node-runtime/,
  );
  assert.match(
    dockerfile,
    /FROM ghcr\.io\/actions\/actions-runner:2\.337\.0@sha256:e5496277be5d09bc968b3d64911b74e219ac4a3f2edce956a3ecf9271bea1ef4/,
  );
  assert.match(dockerfile, /COPY --from=node-runtime \/usr\/local\/bin\/node/);
  assert.match(dockerfile, /ARG SOURCE_REPOSITORY/u);
  assert.doesNotMatch(dockerfile, /org\.opencontainers\.image\.source="https:\/\/github\.com\/apelogic-ai/u);
  assert.match(dockerfile, /USER runner/);
  assert.doesNotMatch(dockerfile, /apt-get (?:dist-)?upgrade/u);
  for (const pinnedPackage of [
    "libc6=2.39-0ubuntu8.9", "libc-bin=2.39-0ubuntu8.9",
    "libcurl3t64-gnutls=8.5.0-2ubuntu10.15",
    "libperl5.38t64=5.38.2-3.2ubuntu0.6", "perl=5.38.2-3.2ubuntu0.6",
    "perl-base=5.38.2-3.2ubuntu0.6", "perl-modules-5.38=5.38.2-3.2ubuntu0.6",
  ]) {
    assert.ok(dockerfile.includes(pinnedPackage), pinnedPackage);
  }
  assert.match(dockerfile, /apt-get purge -y/);
  assert.doesNotMatch(dockerfile, /autoremove/);
  assert.match(dockerfile, /rm -f \/usr\/bin\/containerd \/usr\/bin\/containerd-shim-runc-v2 \/usr\/bin\/ctr/);
  assert.match(dockerfile, /\/usr\/bin\/docker \/usr\/bin\/docker-init \/usr\/bin\/docker-proxy/);
  assert.match(dockerfile, /\/usr\/bin\/dockerd \/usr\/bin\/runc/);
  assert.match(dockerfile, /rm -rf \/usr\/local\/lib\/docker/);
  assert.match(dockerfile, /\/home\/runner\/externals\/node20\/lib\/node_modules\/npm/);
  assert.doesNotMatch(dockerfile, /claude|codex|api[_-]?key|credential|secret/iu);
  assert.doesNotMatch(dockerfile, /ENTRYPOINT|CMD/u);
});

test("the final runner image excludes the build-only GLib package chain", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  const ciWorkflow = await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );

  const buildOnlyPackages = [
    "software-properties-common",
    "python3-software-properties",
    "python3-gi",
    "gir1.2-girepository-2.0",
    "gir1.2-packagekitglib-1.0",
    "gir1.2-glib-2.0",
    "packagekit",
    "libappstream5",
    "libgirepository-1.0-1",
    "python3-dbus",
    "libxmlb2",
    "libglib2.0-0t64",
    "libglib2.0-bin",
    "libglib2.0-data",
    "libgstreamer1.0-0",
    "libpackagekit-glib2-18",
    "polkitd",
    "libpolkit-agent-1-0",
    "libpolkit-gobject-1-0",
  ];
  assert.equal(buildOnlyPackages.length, 19);
  for (const packageName of buildOnlyPackages) {
    assert.match(dockerfile, new RegExp(`\\n\\s+${packageName.replaceAll(".", "\\.")} \\\\`));
  }

  for (const packageName of [
    "gir1.2-glib-2.0",
    "libglib2.0-0t64",
    "libglib2.0-bin",
    "libglib2.0-data",
  ]) {
    assert.match(dockerfile, new RegExp(`! dpkg-query .*${packageName}`));
    assert.match(ciWorkflow, new RegExp(`! dpkg-query .*${packageName}`));
  }
  assert.match(dockerfile, /apt-get check/);
  assert.match(ciWorkflow, /sudo -n apt-get check/);
  assert.match(ciWorkflow, /Runner\.Listener --version/);
  assert.match(ciWorkflow, /ldd \/home\/runner\/bin\/Runner\.Listener/);
  for (const command of ["git", "jq", "python3", "unzip"]) {
    assert.match(ciWorkflow, new RegExp(`command -v ${command}`));
  }
  assert.match(ciWorkflow, /sudo -n true/);
  assert.match(ciWorkflow, /docker --version/);
  assert.match(ciWorkflow, /docker buildx version/);
  assert.match(ciWorkflow, /! command -v docker/);
});

test("the package metadata identifies the in-cluster integration release", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string; license: string };
  const packageLock = JSON.parse(
    await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  ) as { version: string; packages: Record<string, { version?: string }> };

  assert.equal(packageJson.version, "0.7.2");
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageLock.version, "0.7.2");
  assert.equal(packageLock.packages[""]?.version, "0.7.2");
  for (const chart of ["steward-run", "steward-run-arc"]) {
    const metadata = await readFile(
      new URL(`../charts/${chart}/Chart.yaml`, import.meta.url),
      "utf8",
    );
    assert.match(metadata, /^appVersion: 0\.7\.2$/mu);
  }
  const libraryChart = await readFile(new URL("../charts/steward-run/Chart.yaml", import.meta.url), "utf8");
  const applicationChart = await readFile(new URL("../charts/steward-run-arc/Chart.yaml", import.meta.url), "utf8");
  assert.match(libraryChart, /^version: 0\.1\.0$/mu);
  assert.match(applicationChart, /^version: 0\.7\.2$/mu);
});

test("Docker base images receive updates inside the runner support window", async () => {
  const source = await readFile(new URL("../.github/dependabot.yml", import.meta.url), "utf8");
  const config = parse(source) as {
    version: number;
    updates: Array<{
      "package-ecosystem": string;
      directory: string;
      schedule: { interval: string };
    }>;
  };
  const docker = config.updates.find((entry) => entry["package-ecosystem"] === "docker");
  assert.equal(config.version, 2);
  assert.equal(docker?.directory, "/");
  assert.equal(docker?.schedule.interval, "weekly");
});

test("the thin-shell security check is a required build gate", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.match(packageJson.scripts.check ?? "", /check:thin-shell/);
  assert.equal(packageJson.scripts["check:thin-shell"], "node scripts/check-thin-shell.mjs");
});
