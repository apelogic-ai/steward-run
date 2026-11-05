# steward-run v0.8.6

v0.8.6 makes bounded agent stdout and stderr visible in the GitHub Actions job
log for every governed Task source, including failed runs. The signed release
manifest remains schema 3 and binds the exact action/workflow commit, runner
image, chart, checksums, SBOM, provenance, and signature bundles.

## Agent output in every governed job

- `workflow`, `invocation-path`, and `package-path` Tasks replay stdout and
  stderr in separate groups after the Task reaches a terminal state. The same
  path covers successful Tasks, failed Tasks, and cancelled Tasks.
- Agent output remains inert: GitHub workflow-command processing is disabled
  around each stream with an unpredictable per-run token and restored before
  the action continues.
- `execution-log: off|full` remains accepted for package-path compatibility,
  but `off` no longer suppresses Task log visibility.
- Steward v0.3.27 or later provides the authenticated Task log route. A 404/405
  from an older Steward emits one notice and the action continues. Any other log
  retrieval or replay error is also best effort and never changes the Task
  outcome, output extraction, or finalization.
- This release replays the bounded streams at terminal completion rather than
  streaming them while the Task is running.
- The change merged in
  [#133](https://github.com/apelogic-ai/steward-run/pull/133).

## Release integrity

The governed job-container image is bootstrapped and signed for v0.8.6 before
tagging, then pinned by immutable multi-platform digest in the container-based
reusable workflow. The non-publishing release preflight verifies both platform
images, their release labels, the default-branch bootstrap signature, revision
ancestry, and Dockerfile continuity. The self-hosted and vendored workflows do
not declare a job container and therefore have no image digest to pin.
