# steward-run v0.8.3

v0.8.3 adds an optional repository-and-tag image source for the ARC chart and
updates the bundled HTTP client for a security advisory. The signed release
manifest remains schema 3 and binds the exact action/workflow commit, runner
image, chart, checksums, SBOM, provenance, and signature bundles.

## ARC image selection

- The chart adds top-level `image.repository`, `image.tag`, `image.digest`, and
  `image.requireDigest` values for delivery platforms that promote images by tag.
  This source also avoids writing into a list item.
- The new source is default-off. The existing direct container image remains
  supported and digest pinning remains the default.
- `requireDigest` defaults to `true` and requires an exact lowercase SHA-256
  digest. Setting it to `false` requires an exact non-sentinel tag.
- The chart refuses incomplete values, mutable channel tags, the all-zero
  digest placeholder, and simultaneous use of both image sources. The parent
  adapter composes the accepted reference into the vendored scale-set chart
  before its `AutoscalingRunnerSet` renders.
- The feature merged in
  [#121](https://github.com/apelogic-ai/steward-run/pull/121) and was tracked by
  [#119](https://github.com/apelogic-ai/steward-run/issues/119).

## Action runtime security

- The exact `undici` dependency is updated to 7.30.1, the lowest fixed version
  for GHSA-4qv8-2p9j-2685.
- The lockfile and checked-in action bundle are regenerated from that version,
  and the production high-severity dependency audit is clean.
- The fix merged in
  [#120](https://github.com/apelogic-ai/steward-run/pull/120).

## Release integrity

The governed job-container image is bootstrapped and signed for v0.8.3 before
tagging, then pinned by immutable multi-platform digest in the container-based
reusable workflow. The non-publishing release preflight verifies both platform
images, their release labels, the default-branch bootstrap signature, revision
ancestry, and Dockerfile continuity. The self-hosted and vendored workflows do
not declare a job container and therefore have no image digest to pin.

## Upgrade

Upgrade the workflow/action commit, image digest, chart, and optional vendored
workflow together from the signed `oss-release-manifest.json`. Existing chart
values that use the direct digest source require no change.

## Rollback

Restore the v0.8.2 manifest, workflow/action commit, image digest, chart, and
vendored workflow together. Rolling back removes the repository-and-tag image
source and restores the `undici` version affected by GHSA-4qv8-2p9j-2685.
