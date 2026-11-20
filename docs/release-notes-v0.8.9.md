# steward-run v0.8.9

v0.8.9 cancels the governed Steward Task when the calling GitHub Actions job is
cancelled or times out, instead of leaving it running with no caller. The
signed release manifest remains schema 3 and binds the exact action and workflow
commit, runner image, chart, checksums, SBOM, provenance, and signature bundles.

## Cancel the Task when the job stops

- Before this release, a stopped job could leave its Task running in the
  Steward runtime for hours. GitHub stops a step by signalling its entry
  process, but a step in a container job runs through `docker exec`, which
  never forwards SIGINT or SIGTERM. The action never learned that the job had
  stopped and was killed when the job container was removed.
- The action now records the UID of the Task it submitted in a per-invocation
  file under `RUNNER_TEMP`, and keeps it there until its own cleanup request has
  been accepted. A final step of the composite action runs with `always()`, which
  the runner does not cancel, and runs `dist/index.cjs --cancel-recorded-task`.
  When a UID is still recorded, it sends Steward's existing cleanup request,
  `DELETE /v1/tasks/{taskUid}`, for exactly that UID, which cancels a Task that
  has not finished. When nothing is recorded, it sends nothing.
- On SIGINT or SIGTERM the action still sends the cleanup request itself, at
  once, within the runner's shutdown grace period.
- `outcome` is `cancelled` when the job was stopped, instead of `failure`. A
  Task that Steward itself cancelled still reports `failure`, so callers that
  branch on `failure` are unaffected. The reusable and vendored workflows pass
  the new value through unchanged.
- Every cancel attempt prints one line, `Cancelled Steward run <uid>` or
  `Couldn't cancel Steward run <uid>: <reason>`. A failed cancel is also a job
  error, and it never replaces the primary result or fails the final step.
- A GitHub Actions proof ran the action as a container job, stopped once by a
  cancel and once by the job timeout. In both cases the final step sent exactly
  one cleanup request for the submitted Task within a second of the stop.
  `.github/workflows/cancel-proof.yml` reruns that proof on dispatch.
- Peer compatibility: no new Steward capability is required. The cleanup
  request has cancelled a Task that has not finished since Steward v0.1.18, and
  every Steward release this action supports is newer.
- The change merged in
  [#143](https://github.com/apelogic-ai/steward-run/pull/143).

## Release integrity

The governed job-container image is bootstrapped and signed for v0.8.9 before
tagging, then pinned by immutable multi-platform digest in the container-based
reusable workflow. The non-publishing release preflight verifies both platform
images, their release labels, the default-branch bootstrap signature, revision
ancestry, and Dockerfile continuity. The self-hosted and vendored workflows do
not declare a job container and therefore have no image digest to pin.
