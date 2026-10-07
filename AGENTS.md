# Agent instructions

These rules apply to coding agents and contributors working in this repository.
They supplement the documentation under `docs/`.

## Releases

A release tag is immutable. If the tag-triggered release workflow fails, even
before anything is published, the fix ships as the next patch version, and the
CHANGELOG records the failed version as an incomplete publication that must not
be used. Releases therefore must be fully verified **before** the tag exists.

### Preparing a release

1. **Bootstrap and pin the governed job container first.** The release
   workflow promotes a job-container image whose version label must equal the
   release version, signed by the default-branch workflow identity (see
   [`docs/customer-rebuild.md`](docs/customer-rebuild.md)). Bootstrap only builds
   a version that `main` already declares, so a release normally takes two
   sequential pull requests:
   - **Version PR:** bump every release surface to the new version, add the
     release notes, and leave the existing job-container pin in place. Merge it
     without tagging.
   - **Bootstrap:** dispatch **Portable OSS release** with `operation=bootstrap`
     and the new version on `main`.
   - **Pin PR:** pin the printed `job-container-X.Y.Z` digest everywhere the job
     container is pinned (reusable and vendored workflows).

   Sequential pull requests are expected here; this is not a request for
   parallel work.
2. **Prove every release-only check on the PR head.** Before a release pull
   request is ready, every check the tag-triggered release workflow runs must
   pass on its head, using the same entrypoints and tools. That includes the
   preflight, the job-container label and signature checks, chart and image
   contracts, and the vulnerability audit. Link the evidence in the pull
   request. Never claim a check "runs on every PR" without naming the workflow
   job that invokes it.
3. **Use only release-runner tools.** Scripts on the release path may use only
   tools the release runner provides, or tools the release workflow installs
   and checks explicitly.
4. **Keep peer compatibility truthful.** When a release enables a path that
   depends on a peer product's advertised capability or minimum version, name
   the released peer version that provides it.

### Tagging

Do not push release tags. A maintainer, or the coordinator the maintainer
authorized, creates the tag only after CI is green on the exact merge commit
that carries the final job-container pin.
