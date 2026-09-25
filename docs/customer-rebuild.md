# Customer rebuild path (superseded)

Use the [current installation guide](installation.md)
for the maintained fork build, verification, publication, and installation
procedure. It produces the same normalized `IMAGE_REFERENCE`, `CHART_PACKAGE`,
and `WORKFLOW_COMMIT` inputs used by the public-release path.

This page is retained only so old links resolve. It intentionally duplicates
no shell commands: the earlier library-chart-only path is not the supported
installation, and maintaining two runbooks caused version and ordering drift.

The source is MIT licensed. `.github/workflows/portable-release.yml` publishes
the public GHCR image and application chart. `.github/workflows/release.yml`
is a separate ApeLogic-internal ECR evidence workflow and is not the portable
fork publication path.
