# steward-run v0.8.1

v0.8.1 is the complete publication of the package-path change set originally
tagged as v0.8.0. The v0.8.0 workflow stopped before publishing its GitHub
release, runner image, or chart, so v0.8.0 is incomplete and must not be used.
This recovery carries the v0.8.0 feature behavior unchanged and binds it to a
freshly bootstrapped, signed, immutable governed job-container image.

The signed release manifest remains schema 3 and binds the exact
action/workflow commit, runner image, chart, checksums, SBOM, provenance, and
signature bundles.

## Same-repository packages

- The action, all three supported reusable workflows, and the vendored
  workflow accept `package-path`, a canonical repository-relative
  `task-definition.json` path.
- Exactly one of `workflow`, `invocation-path`, or `package-path` is required.
  Ambiguous or missing sources fail before authentication.
- `execution-log` is `off` by default and may be `full`; it is accepted only
  with `package-path`.
- The request is exactly
  `{contractVersion:"steward.task/v2", packagePath,
  diagnostics:{executionLog}}`. Package bytes are not submitted by the action.
- Existing `invocation-path` submissions retain their previous request body
  byte-for-byte.

## Compatibility and safety

`package-path` requires Steward v0.3.10 or later. Before requesting a GitHub
OIDC token, steward-run requires `steward_package_path_supported: true` in
Steward's RFC 9728 metadata. The older
`steward_direct_packages_supported` flag remains the signal for
`invocation-path` and does not pass this gate. An older Steward fails with a
fixed upgrade message rather than receiving an unknown request field.
Steward's `packagePathInvocation` compatibility record sets its minimum
steward-run version to exactly 0.8.0 because v0.8.1 carries that client
behavior unchanged.

The path is validated locally as a canonical, existing, non-symlinked regular
file. Steward remains authoritative for authenticated retrieval from the exact
caller repository and commit.

## Release integrity

The governed job-container digest was bootstrapped and signed for v0.8.1 before
tagging, then pinned in the container-based reusable workflow. Pull-request CI
checks both platform images and fails when their
`org.opencontainers.image.version` labels do not exactly match the repository
release version. The self-hosted and vendored workflows do not declare a job
container and therefore have no image digest to pin.

## Upgrade

Upgrade the workflow/action commit, image digest, chart, and optional vendored
workflow together from the signed `oss-release-manifest.json`. Use
`package-path` only after Steward has been upgraded to v0.3.10 or later and its
metadata advertises the capability.

## Rollback

Restore the v0.7.6 manifest, workflow/action commit, image digest, chart, and
vendored workflow together. Callers using `package-path` must first return to
`invocation-path` or `workflow`, because v0.7.6 does not recognize the new
inputs.
