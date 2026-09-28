# steward-run v0.7.3

This patch release hardens the standalone OSS ARC installation and completes
the tag-bound portable release path. The signed `oss-release-manifest.json`
remains schema 3: its `image` field is still the immutable public image used
for both the ARC runner and governed job-container roles.

## Security and installation hardening

- The application chart now treats the complete scale-set runner template as
  a closed allowlist. It rejects host access, privileged or additional
  containers, Kubernetes API token mounts, root UID/GID paths, unsafe runtime
  profiles, listener-pod customization, namespace overrides, and legacy
  annotation-based AppArmor overrides.
- The supported runner stays non-root, uses `RuntimeDefault` seccomp, drops all
  Linux capabilities, disables privilege escalation and ServiceAccount-token
  automounting, and permits only read-only ConfigMap trust volumes.
- Kubernetes 1.32 through 1.36 remains the supported window. Pod Security
  Admission `restricted` on the dedicated runner namespace remains a required
  second boundary.

## Release integrity

- Portable publication is triggered by an exact semantic `v*` tag and refuses
  a tagged commit that is not reachable from `refs/heads/main`.
- The repository's active `v*` tag ruleset restricts tag creation, update, and
  deletion to organization administrators.
- Image, chart, manifest, and checksum signatures bind the exact tagged
  `portable-release.yml` workflow identity. Installation verification now uses
  that tag-bound identity.

## Runtime and operator contract

- The action uses Node 24 already present in the signed runner image. A
  SHA-pinned `actions/setup-node` v7 fallback runs only when Node 24 is missing,
  with package-manager caching disabled.
- All supported reusable workflows expose the bounded `outcome`,
  `failure-category`, and `http-status` outputs alongside the existing Task
  identifiers and terminal status.
- Artifact Hub metadata is published with the OCI chart, and the installation
  and integration runbooks reflect the exact v0.7.3 artifact and identity
  contract.

Upgrade the reusable-workflow commit, action commit, image digest, and chart
package together from the signed v0.7.3 manifest. Roll back by restoring the
complete verified v0.7.2 handoff.
