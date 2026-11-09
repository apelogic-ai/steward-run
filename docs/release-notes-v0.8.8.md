# steward-run v0.8.8

v0.8.8 lets one GitHub Actions job attempt submit several different governed
Tasks without an idempotency conflict. The signed release manifest remains
schema 3 and binds the exact action and workflow commit, runner image, chart,
checksums, SBOM, provenance, and signature bundles.

## Task-aware idempotency keys

- The default Task submission idempotency key previously covered only
  `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, and `GITHUB_JOB`.
  Two different Tasks from the same job attempt, such as a reusable workflow
  called twice, received the same key, and Steward correctly refused the second
  with `409 TaskIdempotencyConflict`.
- The derived key now also covers the exact Task submission request: the
  `workflow`, `invocation-path`, or `package-path` source (with
  `execution-log`), `envelope-digest`, and `agent-runtime`. Retrying the same
  Task in the same job attempt still reuses its key; different Tasks get
  different keys.
- The new optional `idempotency-key` action input (`STEWARD_RUN_IDEMPOTENCY_KEY`
  for the bundled entry point) overrides the derived key, for example to submit
  the identical Task twice in one job. It and the existing `--idempotency-key`
  flag must be 1 to 128 characters from `A-Z`, `a-z`, `0-9`, `.`, `_`, `:` and
  `-`; an invalid key is refused before any discovery, token, or Task request.
- The Steward API contract is unchanged: Steward still receives one non-empty
  `Idempotency-Key` header, so no newer Steward release is required.
- The reusable and vendored workflows do not forward `idempotency-key`; they
  rely on the Task-aware default.
- The change merged in
  [#139](https://github.com/apelogic-ai/steward-run/pull/139).

## Release integrity

The governed job-container image is bootstrapped and signed for v0.8.8 before
tagging, then pinned by immutable multi-platform digest in the container-based
reusable workflow. The non-publishing release preflight verifies both platform
images, their release labels, the default-branch bootstrap signature, revision
ancestry, and Dockerfile continuity. The self-hosted and vendored workflows do
not declare a job container and therefore have no image digest to pin.
