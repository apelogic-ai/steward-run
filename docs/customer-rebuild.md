# Customer rebuild path (superseded)

Use the [current installation guide](installation.md)
for the maintained fork build, verification, publication, and installation
procedure. It produces the same normalized `IMAGE_REFERENCE`, `CHART_PACKAGE`,
and `WORKFLOW_COMMIT` inputs used by the public-release path.

GitHub requires self-hosted runner applications to be updated within 30 days
of a new runner release. Fork and mirror operators must merge the weekly
Docker base-image update, rebuild and publish the immutable image, verify its
new digest, and roll it out within that window. Dependabot proposes the source
change; it does not publish or deploy an operator's image.

This page is retained only so old links resolve. It intentionally duplicates
no shell commands: the earlier library-chart-only path is not the supported
installation, and maintaining two runbooks caused version and ordering drift.

The source is MIT licensed. `.github/workflows/portable-release.yml` publishes
the public GHCR image and application chart. `.github/workflows/release.yml`
is a separate ApeLogic-internal ECR evidence workflow and is not the portable
fork publication path.
