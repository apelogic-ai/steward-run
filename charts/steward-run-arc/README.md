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
ServiceAccount override. Run the
[read-only preflight](../../docs/arc-controller-preflight.md) against the live
cluster before registration and again with runner-linkage arguments before
dispatching a workload.

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
existing pull Secret in `template.spec.imagePullSecrets`. Publicly trusted
Steward and Identity endpoints require no CA values or mounts.

For private PKI, reference an operator-owned ConfigMap containing only public
CA certificates. Use the exact `steward-run-trust-bundle` volume and read-only
`/etc/steward-run/trust` runner mount in
[`arc-ca-values.yaml`](../../test/fixtures/arc-ca-values.yaml), with
`NODE_EXTRA_CA_CERTS=/etc/steward-run/trust/ca.crt`. Helm render validation
requires one non-empty ConfigMap name, one projected key at `ca.crt`, one
mount, and one environment entry. It fails incomplete or altered shapes. The
environment variable adds the bundle to Node's normal system roots before the
action starts. Never place PEM content or a private key in values.

The latest published chart is v0.5.0. It predates authentication discovery,
so use its [historical installation guide](../../docs/installation-v0.5.0.md)
and explicit Identity exchange inputs. Pull it from the public chart
repository with:

```sh
helm pull oci://ghcr.io/apelogic-ai/charts/steward-run-arc --version 0.5.0
```

The matching runner tag is `ghcr.io/apelogic-ai/steward-run:0.5.0`. Tags are
for discovery only: resolve and pin the image digest from the release's
`oss-release-manifest.json`.

For source after v0.5.0, follow the
[current installation guide](../../docs/installation.md) only with a tagged
release that contains that guide. It covers prerequisites, public artifact
verification or fork publication, GitHub App creation, values, installation,
rotation, upgrade/rollback, and operator checks. Helm replaces lists when
overlaying values, so preserve the complete runner container entry when
changing its image or adding mounts.
