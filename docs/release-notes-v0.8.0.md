# steward-run v0.8.0

This release adds same-repository direct-package submission without changing
the existing invocation-manifest contract. The signed release manifest remains
schema 3 and continues to bind the exact action/workflow commit, runner image,
chart, checksums, SBOM, provenance, and signature bundles.

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

`package-path` requires Steward 0.3.9 or later. Before requesting a GitHub OIDC
token, steward-run requires
`steward_direct_packages_supported: true` in Steward's RFC 9728 metadata. An
older Steward fails with a fixed upgrade message rather than receiving an
unknown request field. Steward's `packagePathInvocation` compatibility record
sets its minimum steward-run version to exactly 0.8.0.

The path is validated locally as a canonical, existing, non-symlinked regular
file. Steward remains authoritative for authenticated retrieval from the exact
caller repository and commit.

## Upgrade

Upgrade the workflow/action commit, image digest, chart, and optional vendored
workflow together from the signed `oss-release-manifest.json`. Use
`package-path` only after Steward has been upgraded to 0.3.9 or later and its
metadata advertises the capability.

## Rollback

Restore the v0.7.6 manifest, workflow/action commit, image digest, chart, and
vendored workflow together. Callers using `package-path` must first return to
`invocation-path` or `workflow`, because v0.7.6 does not recognize the new
inputs.
