# Customer rebuild path (superseded)

Use the [versioned installation guide](installation-v0.4.2.md) for the current
fork-owned runner image, installable application chart, GitHub App, and
acceptance procedure. This document is retained as historical context for
the earlier library-chart rebuild only. The source is MIT licensed, and the
repository now publishes public runner and chart OCI artifacts to GHCR.

The current Dockerfile pins its Node and runner bases by digest and no longer
performs an unbounded package upgrade. A customer build still has its own
source revision, SBOM, provenance, and resulting OCI digest.

## Build and verify in the customer environment

Use a clean checkout at a reviewed 40-character commit, Node.js 24, Helm
3.17+, and a multi-node Docker Buildx builder backed by native `linux/amd64`
and `linux/arm64` workers. Verify the exact commit and
run the source checks before publishing anything:

```sh
test -z "$(git status --porcelain)"
git rev-parse HEAD
npm ci
npm run check
helm dependency build charts/steward-run-arc
# Supply the customer-owned registration URL, existing App Secret name,
# controller ServiceAccount, and immutable image in customer-values.yaml.
helm lint charts/steward-run-arc --strict --values customer-values.yaml
mkdir -p dist
helm package charts/steward-run-arc --destination dist
sha256sum dist/steward-run-arc-*.tgz
```

Set `CUSTOMER_IMAGE_REPOSITORY` to a customer-controlled OCI repository that
the ARC nodes can pull. Then build with the exact source revision and capture
Buildx's digest and provenance/SBOM attestations:

```sh
source_commit="$(git rev-parse HEAD)"
source_version="$(node -p 'require("./package.json").version')"
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --build-arg "VERSION=$source_version" \
  --build-arg "REVISION=$source_commit" \
  --build-arg "SOURCE_REPOSITORY=https://github.com/$FORK_REPOSITORY" \
  --provenance=mode=max \
  --attest "type=sbom,generator=docker.io/docker/buildkit-syft-scanner@sha256:ae4f3b554449e7e25548e7d8ccc029d17357348e30c6e3df01b92bc93654d6a9" \
  --tag "$CUSTOMER_IMAGE_REPOSITORY:$source_version" \
  --metadata-file customer-build-metadata.json \
  --push .
node -p 'require("./customer-build-metadata.json")["containerimage.digest"]'
```

The recorded digest must identify a multi-platform OCI index with exactly one
`linux/amd64` and one `linux/arm64` runnable manifest. The chart consumes that
index digest without an architecture selector; Kubernetes pulls the matching
Linux image for each runner node. Scan and enforce policy against both runnable
child manifests, not just the index or the builder's native architecture.

Keep the source commit, package lock, chart archive SHA-256, image digest,
Buildx attestations, vulnerability scan result, and customer signing evidence
together as the release record. Scan the exact pushed image and enforce the
customer's vulnerability policy before using it. Pin the ARC scale set to
`CUSTOMER_IMAGE_REPOSITORY@sha256:<digest>`; never use the version tag as its
execution identity. The application chart installs the upstream ARC scale
set, while the shared ARC controller remains external.

The existing `steward-task.yml` and `steward-task-self-hosted.yml` remain
ApeLogic-pinned workflows and are not the customer invocation path. Use
[`steward-task-customer.yml`](../.github/workflows/steward-task-customer.yml)
at an exact fork commit as described in the installation guide. Live
governed-job evidence is still open in issue #41. Do not describe the
image/chart build alone as a verified governed-task installation.
The legacy `steward-task.yml` also pins a separate amd64-only job container;
that limitation does not apply to the customer workflow, which runs directly
in the multi-platform ARC runner image.

## Optional customer-owned publication

- A fork may publish its own image and application chart digests instead of
  consuming the public `v0.4.2` artifacts.
- Runtime integration validation remains the operator's responsibility and is
  not part of the standalone OCI artifact handoff.

The native per-platform release workflow builds, scans, and attests both Linux
architectures before assembling one immutable OCI index. A fork may reuse that
mechanism with its own registry and signing identity; the customer installation
still requires the governed-job acceptance evidence described above.
