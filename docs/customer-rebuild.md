# Fork, rebuild, and publish

This procedure produces a standalone distribution from a GitHub fork. The
fork owns its workflow identity, action source, OCI packages, signatures,
release notes, and support boundary. Never combine fork-built artifacts with
an upstream `oss-release-manifest.json`, signature bundle, digest, or
certificate identity.

The release workflow uses only the fork's `GITHUB_TOKEN`. It does not require
an ApeLogic GitHub App, AWS account, ECR repository, governed release job, or
credential rewrite. The three reusable workflows check out the action from
their own exact `job.workflow_repository` and `job.workflow_sha`, so the
action source has no upstream owner or pre-existing action commit. The
container-based wrapper separately carries an immutable job-container digest;
a fork must replace it with a fork-owned digest as described below.

## 1. Prepare the fork

Use GitHub.com and keep the repository's default branch reviewed. In the
fork's **Settings → Actions → General**, allow workflows to create releases
and write packages. Restrict creation, update, and deletion of `v*` tags to
the fork's release administrators. The release preflight independently
rejects a tag whose commit is not on the repository's current default branch.

The workflow defaults to GitHub-hosted labels `ubuntu-24.04` and
`ubuntu-24.04-arm`. If the fork uses different native builders, define these
repository Actions variables:

| Variable | Required capability |
| --- | --- |
| `STEWARD_RUN_RELEASE_AMD64_RUNNER` | trusted Linux amd64 runner with Docker |
| `STEWARD_RUN_RELEASE_ARM64_RUNNER` | trusted Linux arm64 runner with Docker |

Do not point both variables at one emulated builder. The release requires a
native child image from each architecture and verifies the final index.

## 2. Audit the source inputs

Review every immutable external action and image digest before release. The
runner and Node base images are pinned in `Dockerfile`. The ARC
`gha-runner-scale-set` chart is committed at
`charts/steward-run-arc/charts/gha-runner-scale-set-0.14.2.tgz`; chart
packaging and rendering do not contact GHCR. Its upstream OCI manifest digest
and local archive SHA-256 are locked in
`charts/steward-run-arc/third-party-lock.json`.

Verify the vendored dependency and the complete repository contract:

```sh
npm ci
npm run check:vendored-chart
npm run check
npm audit --omit=dev --audit-level=high
```

When intentionally updating ARC, pull the reviewed version into a temporary
directory, verify the digest printed by Helm, replace the one committed
archive, update `Chart.yaml`, `Chart.lock`, `third-party-lock.json`, notices,
schemas, and compatibility documentation, then rerun the commands above. A
normal release must not run `helm dependency build`.

Forks that mirror the two Docker base images must update the `FROM` references,
preserve immutable digests, rebuild both architectures, refresh third-party
notices, and rerun the vulnerability gate. The public workflow still needs
network access to the selected base registries, GitHub action sources, GHCR
publication endpoints, and the pinned ORAS download; only Helm dependency
resolution is source-complete and offline.

The exact Ubuntu packages are resolved from the immutable
`snapshot.ubuntu.com` timestamp in `Dockerfile`, not from the moving archive.
This keeps an unchanged source commit rebuildable after Ubuntu supersedes a
package version. To refresh packages, choose a reviewed UTC snapshot after the
required fixes were published, update `UBUNTU_SNAPSHOT` and every explicit
`name=version` together, build both native architectures, and verify installed
versions with `dpkg-query`. Do not remove exact versions or point a reviewed
release at the moving archive. A plain upstream `docker build .` has a safe
upstream source-label default; every fork release must still pass its own
`SOURCE_REPOSITORY` build argument.

Run the fixable-critical vulnerability gate against both runnable child
manifests after a package refresh. A fixable critical finding cannot be waived.
An unfixed registry-critical finding requires the exact package/CVE acceptance,
security-owner review, substantive justification, and short expiry defined in
the [vulnerability policy](security/vulnerability-policy.md).

## 3. Prepare one version

Choose `X.Y.Z` and update these files in one reviewed commit on the default
branch:

- `package.json` and `package-lock.json` version;
- `charts/steward-run-arc/Chart.yaml` `version` and `appVersion`;
- `CHANGELOG.md` and `docs/release-notes-vX.Y.Z.md`;
- current installation and chart documentation when commands or compatibility
  change.

A fork must also replace its distribution identity before the first tag:

- update `charts/steward-run-arc/Chart.yaml` `home`, repository `sources`, and
  Artifact Hub links, plus the release coordinates in the chart README;
- replace `charts/steward-run-arc/artifacthub-repo.yml` `repositoryID` with the
  ID assigned to the fork's Artifact Hub repository; and
- publish or select an existing fork-owned multi-platform runner image, then
  replace `jobs.governed.container.image` in
  `.github/workflows/steward-task.yml` with its immutable index digest.

Before every release, use the portable release workflow's `bootstrap`
operation to build and verify the prepared version on the configured native
runners. Re-pin its digest deliberately as part of the release-preparation
pull request; do not let the governed job-container image silently trail the
release.

For every fork release, dispatch **Portable OSS release**, select `bootstrap`,
and enter the prepared version. The workflow verifies both native child images,
publishes the immutable
`job-container-X.Y.Z-<commit>` index, keyless-signs its digest with the fork's
default-branch workflow identity, and prints the digest in the run summary.
Pin that exact digest in `.github/workflows/steward-task.yml`, rerun the normal
CI, then dispatch the non-publishing `preflight` operation against the exact
release-preparation branch and version:

```sh
gh workflow run portable-release.yml --ref RELEASE_PREPARATION_BRANCH \
  -f operation=preflight -f version=X.Y.Z
```

Its `pretag-preflight` job requires the branch head to contain the current
default-branch head and validates the package, chart, and immutable image
coordinates. Its `pretag-image-labels` job requires both platform images to
carry the exact release version and repository labels, verifies the bootstrap
signature from the default branch, and proves the bootstrapped Dockerfile
revision is an ancestor of the candidate without later Dockerfile changes.
Link the successful run from the release-preparation pull request, merge the
reviewed result, and only then tag. Release publication promotes that digest
unchanged to `X.Y.Z`; the final schema-3 manifest records it in the existing
`image` field mapped into Steward's `governedJobContainerImage`.

There is no unsigned local-build fallback for this step. The release preflight
requires the selected job-container digest to carry a keyless signature from
this repository's portable workflow on its default branch. If the configured
native GitHub Actions builders are unavailable, restore them or configure
equivalent trusted native runner labels before continuing.

Commit the exact printed `IMAGE@sha256:...` value in the wrapper. The release
preflight rejects a job-container owner that differs from the fork owner and
rejects unchanged upstream chart/Artifact Hub identity.

Repositories that published a legacy `bootstrap-*` tag can dispatch
`retire-bootstrap` with the exact version, tag, and digest. The workflow checks
the two runnable platforms, promotes the digest to `job-container-X.Y.Z`,
keyless-signs and verifies it with the maintenance-only
`steward-run-operation=retire-bootstrap` annotation, then deletes only the
named legacy tag. Release publication rejects that annotation and accepts only
normal `bootstrap` signatures bound to the released version and source
revision. Never delete an unpromoted digest that a released wrapper still pins.

Run `npm run check` again and merge that commit normally. Do not tag an
unmerged pull-request commit.

## 4. Tag and publish

From a clean clone of the fork's updated default branch:

```sh
set -euo pipefail
VERSION=X.Y.Z
git fetch origin --tags
git switch YOUR_DEFAULT_BRANCH
git pull --ff-only origin YOUR_DEFAULT_BRANCH
test -z "$(git status --short)"
test "$(node -p 'require("./package.json").version')" = "$VERSION"
git tag -a "v$VERSION" -m "steward-run v$VERSION"
git push origin "v$VERSION"
```

The tag starts `.github/workflows/portable-release.yml`. It verifies and
promotes the signed pre-tag multi-platform image, publishes the application
chart under `ghcr.io/<fork-owner>`, signs both OCI digests and the release
inventory with the fork's tag-bound GitHub OIDC identity, and creates the
GitHub release. The schema-3 manifest records the tag commit as both
`workflowCommit` and `actionCommit` because the reusable workflows execute the
action from that same immutable source tree.

The supported publication target is the fork owner's GHCR namespace. Copying
artifacts and their signature material to another OCI registry requires a
separately reviewed mirroring and signing procedure and is outside this
workflow's contract.

Watch the run and stop on any failed preflight, promotion, attestation,
signature, or public-asset check:

```sh
gh run list --repo FORK_OWNER/steward-run --workflow portable-release.yml \
  --event push --limit 5
gh run watch RUN_ID --repo FORK_OWNER/steward-run --exit-status
```

Do not recreate or move a published version tag. If publication fails after
both immutable OCI artifacts exist, use the workflow's manual resume inputs
with their exact existing digests; otherwise fix the cause and publish a new
patch version.

## 5. Set and verify package visibility

GHCR package visibility is independent of repository visibility. In the
fork owner's GitHub package settings, make both `steward-run` and the
`steward-run-arc` chart package public when anonymous customer installation is
required. Also confirm each package grants the fork repository Actions access.
Leaving either package private is valid only when every installer and runner
has separately managed read credentials.

Verify from an environment with no GHCR login:

```sh
set -euo pipefail
VERSION=X.Y.Z
REPOSITORY=FORK_OWNER/steward-run
gh release download "v$VERSION" --repo "$REPOSITORY" --dir release
(cd release && sha256sum -c SHA256SUMS)
jq -e --arg repository "$REPOSITORY" \
  '.schemaVersion == 3 and .workflowRepository == $repository and
   .workflowCommit == .actionCommit' \
  release/oss-release-manifest.json
docker buildx imagetools inspect \
  "$(jq -er '.image' release/oss-release-manifest.json)" >/dev/null
helm pull "oci://$(jq -er '.chart' release/oss-release-manifest.json | sed 's/@.*//')" \
  --version "$VERSION"
```

Then repeat the Cosign blob and OCI verification commands from the
[installation guide](installation.md), changing `RELEASE_REPOSITORY` to the
fork. The expected certificate identity is the fork's
`portable-release.yml@refs/tags/vX.Y.Z`, never the upstream identity.

## 6. Hand off and maintain

Give operators the fork's GitHub release URL, signed manifest, verification
identity, exact workflow commit, image digest, chart digest, supported
Kubernetes/ARC window, and fork-specific security contact. Installation uses
the normal guide with `RELEASE_REPOSITORY=FORK_OWNER/steward-run`.

A public fork's reusable workflow can be consumed directly from another
repository at the manifest's exact `workflowCommit`. For a private fork used by
another repository in the same organization, enable that caller under
**Settings → Actions → General → Access**, then copy the verified release asset
`steward-task-vendored.yml` to the caller's
`.github/workflows/steward-task-vendored.yml`. Steward currently renders the
remote reusable-workflow reference, so change only its `uses:` line to
`./.github/workflows/steward-task-vendored.yml`; [Steward issue
#218](https://github.com/apelogic-ai/steward/issues/218) tracks native local
rendering. That official file is generated from
`vendor/steward-task-vendored.yml` and the signed manifest's
`workflowRepository` and `actionCommit`; CI proves it differs from the
supported self-hosted workflow only by removing the internal checkout boundary
and using the immutable direct action reference. It accepts no PAT or checkout
token. The strict default requires at least one file under `out/`; an empty
result stops with `the task wrote nothing to out/` before artifact upload.
Release notes flag changes so callers know when to refresh the vendored file.

Monitor Dependabot and vulnerability-gate results. GitHub requires
self-hosted runners to be updated within 30 days of a new runner release, so a
fork must merge, rebuild, publish, verify, and roll out a replacement digest
inside that window. An unfixed critical vulnerability may be accepted only by
an exact package/CVE entry with a substantive justification, security-owner
review, and a short expiry as described in the
[vulnerability policy](security/vulnerability-policy.md).
