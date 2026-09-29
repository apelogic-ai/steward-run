# Changelog

Notable user-facing changes to `steward-run` are recorded here. Release tags
and published artifacts remain authoritative.

This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.7.6] - 2026-09-29

### Added

- Added an official manifest-rendered, checksum-bound
  `steward-task-vendored.yml` reusable
  workflow for cross-repository consumers of private forks, with a structural
  equivalence gate, an explicit empty-output diagnostic, and no PAT or
  checkout-token input.
- Added signed governed job-container publication. The pre-tag digest is
  promoted unchanged to the release version, so the schema-3 handoff's
  existing `image` field is the exact wrapper image and remains Steward's
  `governedJobContainerImage` source.

### Changed

- Identity exchange 400, 401, and 403 responses now fail after one attempt at
  the bounded `exchange` stage with their HTTP status and correct category.
  Exchange 429, 5xx, and network failures remain retryable.
- Runner builds resolve exact Ubuntu packages from a dated immutable snapshot,
  keeping reviewed source rebuildable after moving archive packages are
  superseded.
- Pre-tag job-container images use durable `job-container-*` tags and are
  keyless-signed by immutable digest only after their exact native inputs are
  verified. Release promotion binds the image version, repository, revision,
  and Dockerfile to the tag. A guarded maintenance operation uses a distinct
  non-release signature while promoting and removing the legacy public
  `bootstrap-*` tag.
- The release publisher installs its vendored-chart validator dependencies
  before packaging, closing the recovery-only gap observed during v0.7.5.

## [0.7.5] - 2026-09-28

### Added

- Added a complete fork-owned rebuild and publication runbook, configurable
  native release-runner labels, self-pinned reusable action sources, and
  release preflights that reject an upstream job-container or chart identity
  in a fork.
- Vendored and checksum-locked ARC chart 0.14.2 so chart linting, rendering,
  and release packaging do not resolve the subchart from GHCR.

### Changed

- Expanded the public workflow boundary gate to every YAML workflow and
  decoded Sigstore payloads, narrowed release permissions to publishing jobs,
  and disabled Docker build-record uploads.
- Clarified the v0.7.4 proxy upgrade boundary: lowercase variables take
  precedence, direct Steward/Identity hosts belong in `NO_PROXY`, and the
  private-CA path follows redirects under the same validation rules.
- The schema-3 release manifest now records the tag commit as both
  `workflowCommit` and `actionCommit`, matching the self-pinned reusable
  workflow source.
- Added a native pre-tag runner-image bootstrap operation and made deliberate
  governed job-container review/re-pinning part of every release. CI verifies
  the wrapper's immutable digest on both supported architectures.

### Security

- Fixed the two v0.4.1 ECR critical occurrences of CVE-2026-75803 by pinning
  `openssl` and `libssl3t64` to Canonical's fixed `3.0.13-0ubuntu3.15` package
  version, verifying it in both native image jobs and the pinned governed
  job-container image, and adding the CVE to the registry-critical baseline.
  v0.7.4 remains affected, so operators must upgrade to v0.7.5; no
  vulnerability acceptance is used.

## [0.7.4] - 2026-09-28

### Added

- Added standard HTTP(S) proxy and `NO_PROXY` support across GitHub OIDC,
  authentication discovery, Identity exchange, and Steward API traffic,
  including the private-CA compatibility path; documented the complete egress
  destination inventory.
- Added an explicit optional Identity exchange audience contract. Omitting it
  remains backward compatible with the historical audience and now emits a
  targeted deprecation warning.

### Changed

- Removed the obsolete AWS/ECR release workflow and its role assumption,
  registry variables, promotion, scan handoff, and dead release helpers. Public
  tag releases now stage a fixed asset set and reject deployment-specific
  references before GitHub publication.
- Tightened the ARC chart to reject unsupported GitHub Enterprise account URLs
  and documented its deliberate scale-to-zero, direct-mode, single-container,
  and GitHub App-only registration boundaries.

## [0.7.3] - 2026-09-28

### Added

- Added bounded action outputs for overall outcome, failure category, and HTTP
  status; every supported reusable workflow exposes the same fields.
- Added Artifact Hub repository publication and organization-level chart
  metadata.
- Added tag-triggered release publication from reviewed `main` commits so
  keyless signatures bind the exact release tag.

### Changed

- The composite action uses an existing Node 24 runtime when present and
  otherwise installs a pinned Node 24 fallback, avoiding downloads in the
  signed runner image while remaining self-contained on hosted runners.
- Clarified that BuildKit provenance/SPDX predicates are embedded OCI
  attestations rather than GitHub artifact attestations, and parameterized
  Cosign verification for the selected release repository.
- Corrected Identity guidance to its actual numeric repository/owner and
  subject/event/ref selectors, removed the stale fork-publication claim, and
  documented the pre-v0.6 discovery migration order.
- Aligned the internal library chart with the application chart's breaking
  Kubernetes 1.32–1.36 support window.

### Fixed

- Closed application-chart runner-pod values to the documented hardened pod,
  template, container, pull-secret, and ConfigMap-volume fields; rejected
  listener-pod and namespace overrides, pinned seccomp, disabled
  ServiceAccount-token automounting, required non-root groups, and documented
  Pod Security Admission `restricted` as a second boundary.

## [0.7.2] - 2026-09-28

### Added

- Added configurable, whole-minute GitHub job and Steward runtime-binding
  timeouts bounded from 1 through 360 while preserving the existing 15-minute
  and 10-minute defaults.
- Added a complete current installation, verification, integration, upgrade,
  rollback, and uninstall runbook. The v0.7.3 correction removes its inaccurate
  private-fork and Identity `job_workflow_ref` policy claims.
- Enabled GitHub private vulnerability reporting and linked the advisory
  channel from the security policy.

### Changed

- **Breaking:** raised the supported Kubernetes window to 1.32–1.36 with
  boundary tests.

### Fixed

- Rejected Helm list overlays that silently remove the runner command,
  security hardening, or resource bounds; pod-level `runAsNonRoot: true` is
  required and container `capabilities.add` is forbidden.
- Removed private cloud registry and account coordinates from public workflow
  and historical security surfaces.

## [0.7.1] - 2026-09-27

### Added

- Added weekly Dependabot checks for Docker base-image updates.

### Fixed

- Updated the runner base to GitHub Actions Runner 2.337.0 and documented the
  30-day rebuild and rollout obligation for fork and mirror operators.
- Corrected installation examples to use Steward's origin URL and Identity's
  exact issuer without a trailing slash, matching the endpoints the services
  publish.
- Documented Steward's existing projection from the schema-3 release
  manifest's signed `image` field to `governedJobContainerImage`.

## [0.7.0] - 2026-09-26

### Added

- Added the optional `envelope-digest` action and reusable-workflow input for
  both versioned Workflow and direct-package Task sources. The value must use
  the public `steward:sha256:<64 lowercase hex>` format and is forwarded
  unchanged to `POST /v1/tasks`. Sending it requires Steward 0.3.0 or newer;
  omitting it remains compatible with older Steward servers when one active
  Envelope is available.
- Added both submission shapes to the checked-in OpenAPI contract and tests for
  action metadata, configuration validation, workflow forwarding, direct-package
  forwarding, and the bundled action.

### Changed

- Callers with multiple active User Envelopes can now select one exact
  owner-scoped authority digest. Existing callers that omit the input remain
  compatible when Steward resolves exactly one active Envelope.
- Updated every supported reusable workflow, the installation guide, action
  specification, checked-in bundle, chart/application metadata, and release
  documentation together for the 0.7.0 contract.

## [0.6.0] - 2026-09-25

### Added

- Secure RFC 9728/RFC 8414 task-authentication discovery rooted at the exact
  Steward API resource, with bounded metadata, zero redirects, exact issuer
  validation, deterministic GitHub OIDC audience selection, and successful-
  result caching.
- Optional, operator-owned public CA ConfigMap support for ARC and library-
  chart runners without placing certificate content in Helm values.

### Changed

- `identity-exchange-url`, `identity-exchange-audience`, and
  `steward-ca-certificate-file` are optional empty-default compatibility inputs
  in every supported workflow. Existing explicit callers remain deterministic
  and receive sanitized deprecation notices; removal requires a separately
  reviewed major-version migration.
- System/process trust and discovery are now the default. See the
  [v0.6.0 release notes](docs/release-notes-v0.6.0.md) for activation order and
  rollback.

## [0.5.0] - 2026-09-24

### Changed

- The application chart now requires an explicit ARC controller namespace and
  ServiceAccount. A release-name resolver follows the pinned ARC 0.14.2 naming
  contract and supports exact ServiceAccount overrides.
- Runner image validation now rejects the all-zero SHA-256 sentinel in both
  the application and library chart paths before reconciliation.
- Promoted the installation guide to v0.5.0 with executable public-release and
  customer-fork paths plus one common install, upgrade, and rollback flow.

### Added

- A released, read-only ARC controller preflight with stable text/JSON failure
  classifications, exact 0.14.2 compatibility checks, optional scale-set
  linkage verification, and documented least-privilege reads.
- A signed public handoff with asset checksums and verified per-platform SLSA
  provenance and SPDX SBOM attestations.
- A third-party license inventory for the bundled action, runner image, and
  application-chart dependency.
- This changelog.

## [0.4.2] - 2026-09-22

### Added

- Published the standalone multi-platform runner image and installable
  `steward-run-arc` chart to public GHCR.
- Attached `oss-release-manifest.json` with immutable image, chart, and source
  identities to the GitHub release.

### Changed

- Made the public release independent of AWS, ApeLogic ECR, and private
  ApeLogic repositories.

## [0.4.1] - 2026-09-21

### Added

- Added the installable ARC scale-set adapter chart and customer-owned
  reusable workflow.
- Added native `linux/amd64` and `linux/arm64` runner publication.
- Added direct-package Task transport and customer installation guidance.

### Changed

- Hardened resumable multi-architecture release assembly and attestation
  validation.
- Removed build-only packages from the runner image and preserved public TLS
  roots when a private CA is configured.

## [0.4.0] - 2026-08-26

### Added

- Added the self-hosted reusable workflow alongside the ARC workflow.
- Added immutable Steward Workflow-reference submission.

### Changed

- Separated the identity-exchange audience from the Steward token audience.
- Added private-CA support to identity exchange without replacing default
  public trust roots.

## Earlier releases

Releases v0.1.0 through v0.3.9 and their immutable tags are available in the
[GitHub release history](https://github.com/apelogic-ai/steward-run/releases).

[Unreleased]: https://github.com/apelogic-ai/steward-run/compare/v0.7.6...HEAD
[0.7.6]: https://github.com/apelogic-ai/steward-run/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/apelogic-ai/steward-run/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/apelogic-ai/steward-run/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/apelogic-ai/steward-run/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/apelogic-ai/steward-run/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/apelogic-ai/steward-run/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/apelogic-ai/steward-run/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/apelogic-ai/steward-run/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/apelogic-ai/steward-run/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/apelogic-ai/steward-run/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/apelogic-ai/steward-run/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/apelogic-ai/steward-run/compare/v0.3.9...v0.4.0
