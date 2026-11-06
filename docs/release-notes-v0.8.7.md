# steward-run v0.8.7

v0.8.7 makes Steward API refusals actionable in the GitHub Actions job log.
The signed release manifest remains schema 3 and binds the exact action and
workflow commit, runner image, chart, checksums, SBOM, provenance, and signature
bundles.

## Actionable Steward refusals

- For a non-2xx Steward API response at any request stage, a JSON string
  `error` is shown as the stable refusal code and published as the `error-code`
  action and reusable-workflow output.
- A JSON string `failureReason` is shown beside the code as Steward's plain
  user-facing sentence. This includes admission refusals such as a model that
  the selected Envelope does not allow.
- Other response fields, headers, and non-JSON bodies are never copied into the
  refusal detail; both displayed strings are bounded, single-line, and stripped
  of control characters.
- Steward v0.3.27 and later release notes advertise `error` and
  `failureReason` as the stable run-refusal client contract. Older Steward
  responses remain compatible: when either field is absent, steward-run omits
  that detail and retains its existing bounded request-failure signal.
- The change merged in
  [#136](https://github.com/apelogic-ai/steward-run/pull/136).

## Release integrity

The governed job-container image is bootstrapped and signed for v0.8.7 before
tagging, then pinned by immutable multi-platform digest in the container-based
reusable workflow. The non-publishing release preflight verifies both platform
images, their release labels, the default-branch bootstrap signature, revision
ancestry, and Dockerfile continuity. The self-hosted and vendored workflows do
not declare a job container and therefore have no image digest to pin.
