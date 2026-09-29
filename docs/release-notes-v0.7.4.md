# steward-run v0.7.4

This patch release completes the standalone OSS publication boundary and makes
restricted-network installation requirements explicit. The signed
`oss-release-manifest.json` remains schema 3 and continues to bind the exact
reusable workflow commit, action commit, multi-platform runner image, and ARC
chart package.

## Portable release boundary

- The obsolete AWS/ECR promotion workflow, role assumption, registry variables,
  scan handoff, and dead release helpers are removed.
- Tag publication stages one fixed GitHub release asset set and checks every
  staged text asset plus the packaged chart for AWS account or role coordinates
  and deployment-only hosts before `gh release create` runs.
- The public release continues to publish the signed multi-platform GHCR image,
  OCI chart, checksums, embedded provenance and SBOM evidence, release manifest,
  and read-only ARC preflight.

## Network and authentication integration

- **Upgrade note:** proxy variables are newly honored in v0.7.4, and lowercase
  `http_proxy`, `https_proxy`, and `no_proxy` take precedence over uppercase
  forms. Put the exact Steward and Identity hosts in `NO_PROXY`/`no_proxy` when
  they must bypass the proxy. The private-CA request path now follows redirects
  while retaining HTTPS/origin validation and certificate verification.
- GitHub OIDC, authentication discovery, Identity exchange, and Steward API
  traffic honor upper- and lowercase `HTTP_PROXY`, `HTTPS_PROXY`, and
  `NO_PROXY` settings. The private-CA compatibility path keeps certificate
  verification enabled through the proxy.
- The installation guide now provides an operator-facing egress inventory for
  Steward, Identity, GitHub runner control traffic, artifact transfer, ARC
  registration, and release installation.
- `identity-exchange-audience` accepts the exchange's exact GitHub OIDC audience.
  It remains optional in v0.7.4: omission retains the historical
  `apelogic-github-identity-exchange` default and emits a value-free deprecation
  warning.

## ARC chart contract

- The application chart rejects unsupported GitHub Enterprise account-scope
  URLs and documents GitHub App-only registration; PAT registration remains
  unsupported.
- Scale-to-zero (`minRunners: 0`), direct container mode, and exactly one
  container named `runner` remain deliberate non-breaking schema constraints.

Upgrade the reusable-workflow commit, action commit, image digest, and chart
package together from the signed v0.7.4 manifest. Roll back by restoring the
complete verified v0.7.3 handoff.
