# v0.7.1: portable handoff corrections

This patch release closes three gaps in the standalone OSS handoff.

The signed `oss-release-manifest.json` remains schema 3. Its existing `image`
field is the public, signed multi-platform image used for both the ARC runner
and governed job-container roles. Steward's installation mapping projects that
exact value to `governedJobContainerImage`; no duplicate manifest field is
needed. The image is smoke-tested for both roles, contains runnable
`linux/amd64` and `linux/arm64` manifests, and is pinned by digest.

Installation examples now use the Steward origin
`https://steward.customer.example`, so protected-resource metadata is read at
the root well-known endpoint and Task calls target `/v1/tasks`. The Identity
issuer is exactly `https://identity.customer.example`, without a trailing
slash, matching the issuer comparison performed during discovery.

The runner base is updated to GitHub Actions Runner 2.337.0. Weekly Dependabot
checks propose Docker base-image updates. Because released images are
immutable and do not self-update, fork and mirror operators remain responsible
for rebuilding, publishing, verifying, and rolling out a new image digest
within GitHub's 30-day runner update window.

Upgrade the reusable-workflow commit, image digest, and chart package as one
verified v0.7.1 handoff. No GitHub App, governed-job configuration, new secret,
or credential migration is required. Roll back by restoring the complete
v0.7.0 handoff.
