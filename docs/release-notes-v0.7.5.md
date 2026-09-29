# steward-run v0.7.5

This patch release makes the standalone OSS distribution fork-rebuildable,
removes network resolution from ARC chart packaging, and remediates the
critical OpenSSL finding carried by the prior runner image. The signed
`oss-release-manifest.json` remains schema 3; artifact names, public image and
chart coordinates, signer identity, Kubernetes 1.32–1.36 support, and ARC
0.14.2 compatibility remain unchanged.

## Security fix

- CVE-2026-75803 is fixed by upgrading both `openssl` and `libssl3t64` to
  Canonical's fixed Ubuntu 24.04 package version `3.0.13-0ubuntu3.15`.
- Both native image jobs verify the installed versions, and the CVE remains in
  the registry-critical ID baseline so a scanner severity mismatch cannot hide
  a regression. No vulnerability acceptance is used.
- The container-based reusable workflow now pins a v0.7.5 bootstrap image built
  on the same trusted native runners. Both children were verified at the fixed
  package version before the immutable multi-platform index was composed, and
  CI pulls the pinned digest on both architectures to prevent it silently
  lagging the release again.
- v0.7.4 remains affected at `3.0.13-0ubuntu3.12`. Operators must upgrade the
  image digest, chart package, and reusable-workflow commit together to v0.7.5.
  Rolling back to v0.7.4 reintroduces this vulnerability.

## Fork-owned rebuild and publication

- `docs/customer-rebuild.md` is an executable fork, rebuild, publish, verify,
  and handoff procedure. It covers fork-owned workflow identity, native runner
  labels, job-container bootstrapping, chart and Artifact Hub identity, GHCR
  visibility, immutable verification, and maintenance.
- Reusable workflows check out and execute the action from their own exact
  `job.workflow_repository` and `job.workflow_sha`. Persistent runners safely
  replace only a stale checkout owned by that workflow; symlinks,
  caller-tracked paths, regular files, and foreign repositories fail closed.
- Release preflight derives the live default branch, requires the tag commit
  on that branch, and rejects upstream job-container or chart identity in a
  fork. Native amd64 and arm64 release runner labels are repository variables
  with GitHub-hosted defaults.
- The portable workflow has a pre-tag `bootstrap` operation for security or
  runtime fixes that cannot wait for the next signed release image. The rebuild
  runbook makes deliberate wrapper-image review and re-pinning a required part
  of every release preparation.
- The schema-3 manifest now records the tag commit as both `workflowCommit`
  and `actionCommit`, matching the immutable self-pinned action source.

## Offline-safe chart packaging

- The exact ARC `gha-runner-scale-set` 0.14.2 archive is committed under the
  application chart and bound to its upstream OCI manifest digest plus local
  SHA-256 in `third-party-lock.json`.
- Linting, rendering, packaging, and release publication use the vendored
  archive and do not run `helm dependency build` or resolve the subchart from
  GHCR. Release publication re-verifies the lock immediately before packaging.

## Release and proxy corrections

- The public workflow boundary now inspects every top-level YAML workflow,
  including mixed-case AWS/ECR references, and the public-asset gate scans
  decoded Sigstore payloads. Write permissions are limited to publishing jobs,
  and Docker build-record uploads are disabled.
- The v0.7.4 release notes now state the proxy upgrade boundary explicitly:
  lowercase proxy variables take precedence, direct Steward and Identity hosts
  belong in `NO_PROXY`/`no_proxy`, and private-CA requests follow redirects
  under the same HTTPS, origin, and certificate validation rules.

Upgrade by verifying the v0.7.5 manifest and replacing its workflow commit,
image digest, and chart digest as one unit. Follow the current installation
guide for preflight, rollout, live delivery verification, and rollback limits.
