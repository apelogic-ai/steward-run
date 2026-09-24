# steward-run-arc application chart

This is the installable customer chart. It wraps the upstream
`gha-runner-scale-set` chart at 0.14.2 and creates one ARC runner scale set,
listener, and scoped service accounts/RBAC. The shared ARC controller and its
CRDs are prerequisites and are not owned by this release. The chart requires
an existing GitHub App Secret reference, a GitHub registration URL, and an
operator-selected runner image pinned by `sha256` digest. No credential value is
accepted in Helm values.

The separately installed controller identity is also required explicitly at
`gha-runner-scale-set.controllerServiceAccount.namespace` and `.name`; the
chart never performs ARC's cluster-wide fallback discovery. For the pinned
ARC controller chart 0.14.2, generate the standard identity from the exact
controller Helm release name with:

```sh
node scripts/arc-controller-identity.mjs \
  --namespace arc-system --release-name arc --output values
```

The standard `arc` release resolves to `arc-system/arc-gha-rs-controller`.
Pass `--service-account-name` when the controller chart uses an explicit
ServiceAccount override.

The image must be a released immutable reference in
`repository@sha256:<64 lowercase hex>` form. Mutable tags and sentinel values,
including the all-zero SHA-256 placeholder, fail schema validation before any
cluster reconciliation.

The image digest may identify the supported multi-platform OCI index with
`linux/amd64` and `linux/arm64` manifests. This chart deliberately sets no
architecture selector; Kubernetes selects the matching image on each runner
node.

Default behavior is zero idle runners, five maximum, direct execution in the
digest-pinned runner image, a non-root Pod, no privilege escalation, and no
mounted Kubernetes API token. If the image registry is private, reference an
existing pull Secret in `template.spec.imagePullSecrets`. For a customer CA,
mount an operator-owned public ConfigMap in the runner Pod; the default does
not invent trust material.

The public chart repository is
`oci://ghcr.io/apelogic-ai/charts/steward-run-arc`; pull version `0.4.2` with:

```sh
helm pull oci://ghcr.io/apelogic-ai/charts/steward-run-arc --version 0.4.2
```

The matching runner tag is `ghcr.io/apelogic-ai/steward-run:0.4.2`. Tags are
for discovery only: resolve and pin the image digest from the release's
`oss-release-manifest.json`.

Follow the [v0.4.2 installation guide](../../docs/installation-v0.4.2.md)
for prerequisites, public artifact verification or fork publication, GitHub
App creation, values, installation, rotation, upgrade/rollback, and operator
checks. Helm replaces lists when overlaying values, so preserve the complete
runner container entry when changing its image or adding mounts.
