# Customer rebuild path (source access required)

The current steward-run release workflow publishes the ARC runner image only
to ApeLogic's private ECR. It does **not** publish a public runner image or an
OCI library chart. This repository is also private. Therefore this document
does not claim that an anonymous customer can obtain or independently audit a
release today. A customer needs separately granted access to an exact source
commit and the applicable rights to build and use it.

With that access, the customer can build an inspectable artifact into a
customer-owned OCI registry. This is an alternative build, **not** a
byte-for-byte reproduction of the ApeLogic release digest: the Dockerfile
performs a package-manager upgrade, and the resulting bytes may depend on
upstream package state. Record both the source commit and the new artifact
digest; never substitute the private ECR digest for the customer build.

## Build and verify in the customer environment

Use a clean checkout at a reviewed 40-character commit, Node.js 24, Helm
3.17+, and a Docker Buildx builder. Verify the exact commit and run the source
checks before publishing anything:

```sh
test -z "$(git status --porcelain)"
git rev-parse HEAD
npm ci
npm run check
helm lint charts/steward-run --strict
mkdir -p dist
helm package charts/steward-run --destination dist
sha256sum dist/steward-run-*.tgz
```

Set `CUSTOMER_IMAGE_REPOSITORY` to a customer-controlled OCI repository that
the ARC nodes can pull. Then build with the exact source revision and capture
Buildx's digest and provenance/SBOM attestations:

```sh
source_commit="$(git rev-parse HEAD)"
source_version="$(node -p 'require("./package.json").version')"
docker buildx build \
  --platform linux/amd64 \
  --build-arg "VERSION=$source_version" \
  --build-arg "REVISION=$source_commit" \
  --provenance=mode=max --sbom=true \
  --tag "$CUSTOMER_IMAGE_REPOSITORY:$source_version" \
  --metadata-file customer-build-metadata.json \
  --push .
node -p 'require("./customer-build-metadata.json")["containerimage.digest"]'
```

Keep the source commit, package lock, chart archive SHA-256, image digest,
Buildx attestations, vulnerability scan result, and customer signing evidence
together as the release record. Scan the exact pushed image and enforce the
customer's vulnerability policy before using it. Pin the ARC scale set to
`CUSTOMER_IMAGE_REPOSITORY@sha256:<digest>`; never use the version tag as its
execution identity. The library chart must be imported by an
environment-owned wrapper; it does not install ARC or create a workload.

The default `steward-task.yml` reusable workflow independently pins an ECR
**job-container** image. Rebuilding the ARC runner image alone does not make
that workflow usable without the existing ECR pull entitlement. The separate
`steward-task-self-hosted.yml` workflow omits a job container but requires a
customer-operated vetted runner and explicit Identity allowlisting for that
workflow identity. Neither path removes the need for access to this private
source repository to invoke its reusable workflow and pinned action.

## Work still required for anonymous OSS-style distribution

- Decide source visibility and licensing, or provide an equivalent inspectable
  source-distribution contract. This document does not grant either.
- Authorize and implement a public runner-image and library-chart publication
  destination, with exact-digest mirroring, signatures, SBOM/provenance,
  anonymous pull checks, and a signed public handoff. No such artifact is
  currently published by this repository.
- Move the independently pinned governed job-container to a previously
  published, verified customer-accessible digest in a **later** workflow
  revision. It must not point to an image that the same release has not yet
  published.

The current ECR release workflow and DEV handoff remain unchanged until those
steps are separately reviewed.
