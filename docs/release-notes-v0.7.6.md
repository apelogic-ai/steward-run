# steward-run v0.7.6

This release makes first-time Identity policy denials actionable, provides the
official private-fork vendoring path, and closes the remaining governed
job-container supply-chain gaps. The release manifest remains schema 3.

## Identity exchange diagnostics

- Identity exchange HTTP 400, 401, and 403 responses are no longer retried or
  collapsed into `transport`.
- A 401 makes one exchange attempt and reports
  `failure-category=authentication`, `http-status=401`, and request stage
  `exchange`. A 403 reports `authorization`.
- The fixed `steward-run.identity-exchange/v1` diagnostic directs operators to
  check repository, subject, event, and ref policy selectors without exposing
  the OAuth response body or tokens.
- Exchange 429, 5xx, and network failures remain retryable.

## Private-fork vendoring

- Release assets now include a fully rendered
  `steward-task-self-hosted.yml`, its source template, and the deterministic
  renderer.
- The rendered file calls the signed manifest's exact
  `workflowRepository@actionCommit` directly. It removes only the reusable
  workflow's internal source checkout boundary and accepts no PAT or checkout
  token.
- CI proves the template remains structurally equivalent to the supported
  self-hosted workflow. Private-fork callers using the vendored file must
  refresh it for v0.7.6.

## Image and release integrity

- Exact Ubuntu package versions are resolved from the immutable
  `20260928T000000Z` snapshot, so the image remains rebuildable after archive
  rotation.
- Pre-tag governed job-container images are keyless-signed and use
  `job-container-*` tags. The guarded `retire-bootstrap` operation signs and
  promotes the v0.7.5 bootstrap digest before deleting its legacy public tag.
- Release publication promotes the pre-tag digest unchanged. The schema-3
  manifest's existing `image` field is therefore both the signed release image
  consumed by Steward and the exact digest embedded in `steward-task.yml`.
- The release publisher now installs validator dependencies before checking the
  vendored ARC archive, so a first-pass tag publication no longer needs the
  v0.7.5 recovery workaround.

## Upgrade

Upgrade the workflow/action commit, image digest, chart, and released vendored
workflow as one verified v0.7.6 unit. Re-run the read-only ARC preflight and one
governed delivery test. For a private fork consumed from another repository,
replace the caller's `.github/workflows/steward-task-self-hosted.yml` with the
verified v0.7.6 release asset.

## Rollback

Restore the prior manifest, workflow/action commit, image digest, chart, and
vendored workflow together. Rolling back to v0.7.5 restores the old exchange
401 retry/misclassification behavior and the non-snapshot package build path.
