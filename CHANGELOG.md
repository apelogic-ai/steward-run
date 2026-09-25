# Changelog

Notable user-facing changes to `steward-run` are recorded here. Release tags
and published artifacts remain authoritative.

This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

No unreleased changes.

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

[Unreleased]: https://github.com/apelogic-ai/steward-run/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/apelogic-ai/steward-run/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/apelogic-ai/steward-run/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/apelogic-ai/steward-run/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/apelogic-ai/steward-run/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/apelogic-ai/steward-run/compare/v0.3.9...v0.4.0
