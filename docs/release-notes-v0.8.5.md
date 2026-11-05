# steward-run v0.8.5

v0.8.5 fixes direct-package Tasks against current Steward releases and picks up
a fixed Ubuntu package in the governed job image. The signed release manifest
remains schema 3 and binds the exact action/workflow commit, runner image,
chart, checksums, SBOM, provenance, and signature bundles.

## Direct-package Tasks no longer fail with malformed-response

- Against Steward 0.3.16 and later, every `invocation-path` and `package-path`
  Task failed at submit with
  `steward-run.failure/v1 phase=unavailable failure-category=malformed-response`
  (HTTP 202). Steward had accepted the Task. The response carried optional
  evidence fields (`requestedRequirements`, `requestedDiagnostics`,
  `taskRuntimeMinutesLimit`, `requestedWorkspace`, `workspace`) that the client
  rejected. `workflow:` Tasks were unaffected.
- Response parsing now validates only the fields this client knows. Unknown
  fields, evidence entries and admission-delta kinds are ignored. Known fields
  keep their type and consistency checks.
- Steward's published v2 Task status fixture is now part of the test suite.
- The fix merged in
  [#130](https://github.com/apelogic-ai/steward-run/pull/130).

## Governed job image

- Picks up Ubuntu's fixed `libbrotli1` `1.1.0-2ubuntu0.1` (CVE-2026-111497)
  from the 2026-10-27 package snapshot, with curl `8.5.0-2ubuntu10.16` and
  OpenSSL `3.0.13-0ubuntu3.16`, current at that snapshot.

## Release integrity

The governed job-container image is bootstrapped and signed for v0.8.5 before
tagging, then pinned by immutable multi-platform digest in the container-based
reusable workflow. The non-publishing release preflight verifies both platform
images, their release labels, the default-branch bootstrap signature, revision
ancestry, and Dockerfile continuity. The self-hosted and vendored workflows do
not declare a job container and therefore have no image digest to pin.
