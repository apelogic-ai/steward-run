# steward-run v0.8.4

v0.8.4 adds an optional runner group setting to the ARC chart. The signed
release manifest remains schema 3 and binds the exact action/workflow commit,
runner image, chart, checksums, SBOM, provenance, and signature bundles.

## ARC runner group

- The chart accepts an optional `gha-runner-scale-set.runnerGroup` value. Set it
  to the non-empty name of an existing runner group to register the runner
  scale set in that group.
- The value is unset by default. Leaving it unset keeps the existing
  default-group behavior and the existing chart render unchanged.
- The chart refuses an empty runner group name. It does not create or manage
  runner groups; the group must already exist in GitHub.
- The feature merged in
  [#126](https://github.com/apelogic-ai/steward-run/pull/126).

## Release integrity

The governed job-container image is bootstrapped and signed for v0.8.4 before
tagging, then pinned by immutable multi-platform digest in the container-based
reusable workflow. The non-publishing release preflight verifies both platform
images, their release labels, the default-branch bootstrap signature, revision
ancestry, and Dockerfile continuity. The self-hosted and vendored workflows do
not declare a job container and therefore have no image digest to pin.

## Upgrade

Upgrade the workflow/action commit, image digest, chart, and optional vendored
workflow together from the signed `oss-release-manifest.json`. Existing chart
values require no change.

## Rollback

Restore the v0.8.3 manifest, workflow/action commit, image digest, chart, and
vendored workflow together. Remove `gha-runner-scale-set.runnerGroup` from the
chart values before installing the v0.8.3 chart, which does not accept it.
Runners then register in the default runner group again.
