# steward-run-arc application chart

This is the installable customer chart. It wraps the upstream
`gha-runner-scale-set` chart at 0.14.2 and creates one ARC runner scale set,
listener, and scoped service accounts/RBAC. The shared ARC controller and its
CRDs are prerequisites and are not owned by this release. The chart requires
an existing GitHub App Secret reference, a GitHub registration URL, and an
operator-selected runner image pinned by `sha256` digest. No credential value is
accepted in Helm values.

The exact upstream chart archive is committed under `charts/` and bound to
its upstream OCI manifest digest plus local archive SHA-256 in
`third-party-lock.json`. Normal lint, template, package, and release commands
use that vendored archive and must not run `helm dependency build`. Run
`npm run check:vendored-chart` before packaging. The controlled dependency
refresh procedure is documented in the repository's
[fork publication guide](../../docs/customer-rebuild.md).

The supported Kubernetes window is 1.32 through 1.36 inclusive. CI renders
every minor in that window and rejects versions outside it.

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

Registration is deliberately limited to GitHub.com organization or repository
URLs. `https://github.com/enterprises/...` is rejected because GitHub Enterprise
account scope is not supported. The existing `githubConfigSecret` must contain
the three GitHub App keys documented in the installation guide; PAT registration
through a `github_token` key is unsupported. Because this chart never reads
Secret data, operators verify that key inventory before installation.

The remaining narrow values are intentional security and capacity boundaries:
`minRunners` is fixed at `0` for scale-to-zero, `containerMode.type` is fixed at
the empty direct-runner mode (no DinD or Kubernetes job-container mode), and the
single container is named `runner`. Forks that relax those constraints own the
resulting privilege, capacity, and compatibility contract.

Default behavior is zero idle runners, five maximum, direct execution in the
digest-pinned runner image, a non-root Pod UID/GID, no privilege escalation,
no added capabilities, `RuntimeDefault` seccomp, no init or ephemeral
containers, no host access, and no mounted Kubernetes API token. The values
schema closes the runner Pod spec to the documented pod context, pull-secret
references, one runner container, and optional ConfigMap trust volumes; every
other pod or container field is rejected. Runner-template metadata, listener
pod customization, and namespace overrides are also rejected, keeping the
scale set in the selected restricted namespace without annotation-based
profile overrides. Enforce the Kubernetes Pod Security Admission `restricted`
policy on the dedicated runner namespace as a second boundary. If the image
registry is private, reference an
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

The action HTTP client honors `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`, plus
their lowercase equivalents, for GitHub OIDC, discovery, exchange, and Steward
API requests. Lowercase values take precedence when both forms are present.
Configure proxy environment and any intercepting CA on the runner/job boundary;
do not put proxy credentials in Helm values. The complete destination inventory
and proxy behavior are in the installation guide.

The v0.7.4 chart and runner include the optional exact User Envelope selector,
authentication discovery, and system trust by default. Follow the
[current installation guide](../../docs/installation.md)
and pull the chart from the public repository with:

```sh
helm pull oci://ghcr.io/apelogic-ai/charts/steward-run-arc --version 0.7.4
```

The matching runner tag is `ghcr.io/apelogic-ai/steward-run:0.7.4`. Tags are
for discovery only: resolve and pin the image digest from the release's
`oss-release-manifest.json`.

The [historical v0.5.0 guide](../../docs/installation-v0.5.0.md) applies only
to that release and its required explicit Identity exchange inputs. The
current guide covers discovery, compatibility inputs, trust, upgrade,
rollback, and operator checks. Helm replaces lists when overlaying values. The
chart schema therefore rejects a replacement runner entry that omits the run
command, image pull policy, no-privilege security context, or CPU/memory
requests and limits. It also requires non-root pod UID/GID and supplemental
groups, pins `RuntimeDefault` seccomp, keeps ServiceAccount-token automounting
off, permits only read-only ConfigMap volumes, and rejects all unlisted pod and
container fields. Preserve the complete entry when changing its image or
adding mounts.

Artifact Hub indexes this OCI chart as
[`steward-run-arc`](https://artifacthub.io/packages/helm/steward-run/steward-run-arc).
The release workflow refreshes the repository's `artifacthub.io` metadata tag
on every chart release.
