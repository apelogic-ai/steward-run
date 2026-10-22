# steward-run v0.8.2

v0.8.2 removes an unused vulnerable package from the governed runner image,
accepts successful idempotent Task replays, and adds explicit command-line
inputs for bundled callers outside GitHub Actions. The signed release manifest
remains schema 3 and binds the exact action/workflow commit, runner image,
chart, checksums, SBOM, provenance, and signature bundles.

## Runner image security

- The governed runner image removes the unused `python3-jwt` package and its
  reverse-dependency chain, resolving CVE-2026-102267 and CVE-2026-102268
  without a vulnerability-policy exception.
- The Dockerfile contract and both native image smoke jobs assert that
  `python3-jwt` is absent while retaining the runner user, executable
  `/home/runner/run.sh`, Kubernetes hooks, and the required Python runtime.
- The fix merged in [#113](https://github.com/apelogic-ai/steward-run/pull/113)
  and is tracked for release by
  [#116](https://github.com/apelogic-ai/steward-run/issues/116).

## Task submission

- A successful idempotent replay is accepted when Steward returns the
  original Task with HTTP 200 instead of creating it with HTTP 201.
- The public API contract now requires a non-empty idempotency key, matching
  the client validation and Steward behavior.

## Bundled callers

- The bundled executable accepts explicit `--idempotency-key`, `--workspace`,
  and `--outputs-file` flags for callers outside GitHub Actions.
- Existing GitHub Actions callers retain their environment-derived defaults.
  Flag values take precedence when supplied, and required inputs still fail
  before authentication when neither source is available.

## Release integrity

The governed job-container image is bootstrapped and signed for v0.8.2 before
tagging, then pinned by immutable multi-platform digest in the container-based
reusable workflow. The non-publishing release preflight verifies both platform
images, their release labels, the default-branch bootstrap signature, revision
ancestry, and Dockerfile continuity. The self-hosted and vendored workflows do
not declare a job container and therefore have no image digest to pin.

## Upgrade

Upgrade the workflow/action commit, image digest, chart, and optional vendored
workflow together from the signed `oss-release-manifest.json`.

## Rollback

Restore the v0.8.1 manifest, workflow/action commit, image digest, chart, and
vendored workflow together. Rolling back reintroduces the vulnerable
`python3-jwt` package in the v0.8.1 runner image and removes the idempotent
replay and explicit bundled-caller behavior above.
