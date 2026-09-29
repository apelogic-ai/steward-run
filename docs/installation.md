# steward-run v0.7.5 installation, setup, and integration

This is the complete operator runbook for the standalone OSS release. Use one
tagged release as a unit: reusable workflow, action commit, runner image, and
Helm chart must all come from its signed `oss-release-manifest.json`. Do not
mix artifacts from different releases.

The upstream repository protects creation, update, and deletion of `v*` tags
with an active ruleset restricted to organization administrators. The portable
release preflight also requires the tagged commit to be reachable from
`refs/heads/main` before it publishes artifacts.

The manifest remains schema 3. Its `image` field is the signed public
multi-platform image used for both the ARC runner and governed job-container
roles. Steward's
[installation mapping](https://github.com/apelogic-ai/steward/blob/v0.3.0/docs/installation/governed-platform-compatibility.md#installation-bom)
projects that exact value to `governedJobContainerImage`; no additional
manifest field is required.

The [v0.5.0 guide](installation-v0.5.0.md) is historical and applies only to
that release. Do not use its versions, paths, or explicit-authentication
defaults for v0.7.5.

## Prerequisites

Hard requirements:

- GitHub.com Actions. GitHub Enterprise Server is not covered because the
  self-pinned workflow uses `job.workflow_repository` and `job.workflow_sha`.
- A GitHub App already configured for ARC runner registration and an existing
  Kubernetes `Opaque` Secret with keys `github_app_id`,
  `github_app_installation_id`, and `github_app_private_key`. This chart only
  references that Secret; it never creates or rotates registration credentials.
- Kubernetes 1.32 through 1.36 inclusive, with `linux/amd64` or `linux/arm64`
  schedulable nodes.
- Helm 3.17+, `kubectl`, GitHub CLI (`gh`), `jq`, `sha256sum`, Node.js 24,
  and Cosign 3.1+ on the operator workstation.
- The upstream `gha-runner-scale-set-controller` chart at exactly 0.14.2,
  installed separately. The `steward-run-arc` chart does not own the shared
  controller or its CRDs.
- A reachable Steward HTTPS Task API that implements the checked-in
  [`/v1/tasks` contract](../contracts/steward-run-v1.openapi.yaml), publishes
  RFC 9728 metadata, and points to an Identity issuer publishing RFC 8414
  metadata.
- DNS, TLS, and runner egress to GitHub, GHCR, Steward, and Identity.

The release contains no GitHub App key, registry credential, Steward token,
CA private key, or customer configuration. Public GHCR pulls require no
registry Secret. Keep all operator-owned credential handling outside this
runbook and outside Helm values.

## Installation

### 1. Download and verify one release

Run these commands in an empty directory. A version tag is used only to find
the release; deployment uses immutable digests and 40-character commits from
the signed manifest.

```sh
set -euo pipefail
RELEASE_VERSION=0.7.5
RELEASE_TAG="v$RELEASE_VERSION"
RELEASE_REPOSITORY=apelogic-ai/steward-run
RELEASE_IDENTITY="https://github.com/$RELEASE_REPOSITORY/.github/workflows/portable-release.yml@refs/tags/$RELEASE_TAG"

gh release download "$RELEASE_TAG" --repo "$RELEASE_REPOSITORY" --dir .
sha256sum -c SHA256SUMS

cosign verify-blob --bundle oss-release-manifest.sigstore.json \
  --certificate-identity "$RELEASE_IDENTITY" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  oss-release-manifest.json
cosign verify-blob --bundle SHA256SUMS.sigstore.json \
  --certificate-identity "$RELEASE_IDENTITY" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  SHA256SUMS

test "$(jq -er '.schemaVersion' oss-release-manifest.json)" = 3
test "$(jq -er '.version' oss-release-manifest.json)" = "$RELEASE_VERSION"
test "$(jq -er '.workflowRepository' oss-release-manifest.json)" = "$RELEASE_REPOSITORY"
test "$(jq -cer '.platforms' oss-release-manifest.json)" = '["linux/amd64","linux/arm64"]'
test "$(jq -er '.arcControllerVersion' oss-release-manifest.json)" = 0.14.2

IMAGE_REFERENCE="$(jq -er '.image' oss-release-manifest.json)"
CHART_REFERENCE="$(jq -er '.chart' oss-release-manifest.json)"
WORKFLOW_COMMIT="$(jq -er '.workflowCommit' oss-release-manifest.json)"
ACTION_COMMIT="$(jq -er '.actionCommit' oss-release-manifest.json)"
printf '%s\n' "$IMAGE_REFERENCE" | grep -Eq '^ghcr\.io/[a-z0-9._-]+/steward-run@sha256:[0-9a-f]{64}$'
printf '%s\n' "$CHART_REFERENCE" | grep -Eq '^ghcr\.io/[a-z0-9._-]+/charts/steward-run-arc@sha256:[0-9a-f]{64}$'
printf '%s\n' "$WORKFLOW_COMMIT" "$ACTION_COMMIT" | grep -Ec '^[0-9a-f]{40}$' | grep -Fx 2

cosign verify --experimental-oci11=true \
  --certificate-identity "$RELEASE_IDENTITY" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  "$IMAGE_REFERENCE"
cosign verify --experimental-oci11=true \
  --certificate-identity "$RELEASE_IDENTITY" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  "$CHART_REFERENCE"

CHART_OCI="oci://${CHART_REFERENCE%@*}"
CHART_DIGEST="${CHART_REFERENCE##*@}"
HELM_PULL_OUTPUT="$(helm pull "$CHART_OCI" --version "$RELEASE_VERSION" 2>&1)"
printf '%s\n' "$HELM_PULL_OUTPUT"
printf '%s\n' "$HELM_PULL_OUTPUT" | grep -Fx "Digest: $CHART_DIGEST"
CHART_PACKAGE="$PWD/steward-run-arc-$RELEASE_VERSION.tgz"
test -f "$CHART_PACKAGE"
```

Retain the manifest, checksum inventory, signature bundles, chart package,
and `release-attestation-summary.json` with the deployment record. The summary
binds verified embedded BuildKit SLSA provenance and SPDX SBOM predicates to
each runnable child manifest of the multi-platform OCI index. These are OCI
image attestations, not GitHub artifact attestations; `gh attestation verify`
is therefore not the verification command for this handoff. The Cosign
commands above verify the image, chart, manifest, and checksum inventory
against the exact release-workflow identity. `RELEASE_REPOSITORY` keeps that
repository binding explicit; this maintained path sets it to the public
upstream. An independent distribution must follow the complete
[fork, rebuild, and publish procedure](customer-rebuild.md) and must not reuse
the upstream manifest or certificate identity.

### 2. Select the cluster and verify ARC 0.14.2

Use an explicit kubeconfig and context for every mutation. The example assumes
the standard ARC release `arc` in namespace `arc-system`.

```sh
KUBECONFIG_FILE=/absolute/path/to/cluster-kubeconfig
KUBE_CONTEXT=production-cluster
ARC_CONTROLLER_NAMESPACE=arc-system
ARC_CONTROLLER_RELEASE=arc
RUNNER_NAMESPACE=arc-runners
RUNNER_RELEASE=steward-run
RUNNER_SCALE_SET=steward-run

kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" cluster-info
```

If the shared controller is not already installed, an authorized cluster
operator can install the pinned upstream release:

```sh
helm --kubeconfig "$KUBECONFIG_FILE" --kube-context "$KUBE_CONTEXT" \
  upgrade --install "$ARC_CONTROLLER_RELEASE" \
  oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller \
  --version 0.14.2 --namespace "$ARC_CONTROLLER_NAMESPACE" --create-namespace \
  --wait --timeout 10m
```

Run the released read-only preflight. It reads no Secrets and prints no token
or credential data:

```sh
node ./steward-run-arc-preflight.mjs \
  --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" \
  --namespace "$ARC_CONTROLLER_NAMESPACE" \
  --release-name "$ARC_CONTROLLER_RELEASE"
```

For the standard release, the emitted identity is
`arc-system/arc-gha-rs-controller`. Pass `--service-account-name` when the
controller installation explicitly overrides its ServiceAccount.

### 3. Verify the existing registration reference

This procedure does not create or alter GitHub App credentials. Set the name
of the operator-owned Secret and verify only its type and key inventory:

```sh
GITHUB_CONFIG_URL=https://github.com/CUSTOMER_ORG/CUSTOMER_REPOSITORY
GITHUB_APP_SECRET=steward-run-github-app

kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" \
  --namespace "$RUNNER_NAMESPACE" get secret "$GITHUB_APP_SECRET" -o json |
  jq -e '
    .type == "Opaque" and
    (.data | has("github_app_id")) and
    (.data | has("github_app_installation_id")) and
    (.data | has("github_app_private_key"))
  ' >/dev/null
```

The App must be installed for the organization or repository in
`GITHUB_CONFIG_URL` and have the permissions required by upstream ARC. The App
is only for runner registration; it is not a Steward bearer credential.
GitHub Enterprise account URLs under `https://github.com/enterprises/` and PAT
registration Secrets containing `github_token` are unsupported. The schema
rejects enterprise-scope URLs; the key-inventory check above is the operator
gate for the referenced Secret because this chart never reads Secret values.

### 4. Create the complete hardened values file

Helm replaces lists instead of merging them. Keep the entire runner container
entry below when changing the image or adding mounts. The chart schema rejects
an entry that drops the run command, pull policy, no-privilege security
context, or CPU/memory requests and limits. The runner Pod spec is a closed
allowlist: it accepts only the documented hardened pod context, pull-secret
references, one runner container, and optional ConfigMap trust volumes. It
pins `RuntimeDefault` seccomp, requires non-root UID/GID and supplemental
groups, disables ServiceAccount-token automounting, permits only read-only
ConfigMap mounts, and rejects every other pod or container field.
It intentionally fixes `minRunners: 0`, direct mode
`containerMode.type: ""`, and one container named `runner`; warm pools, DinD,
Kubernetes container mode, sidecars, and renamed runner containers are outside
the supported chart contract. Fork operators who relax those constraints own
the resulting capacity, privilege, and compatibility validation.

```sh
cat > customer-values.yaml <<YAML
gha-runner-scale-set:
  githubConfigUrl: $GITHUB_CONFIG_URL
  githubConfigSecret: $GITHUB_APP_SECRET
  controllerServiceAccount:
    namespace: $ARC_CONTROLLER_NAMESPACE
    name: arc-gha-rs-controller
  runnerScaleSetName: $RUNNER_SCALE_SET
  scaleSetLabels:
    - steward-run
  minRunners: 0
  maxRunners: 5
  containerMode:
    type: ""
  template:
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
        fsGroupChangePolicy: OnRootMismatch
        seccompProfile:
          type: RuntimeDefault
      imagePullSecrets: []
      containers:
        - name: runner
          image: $IMAGE_REFERENCE
          imagePullPolicy: IfNotPresent
          command: ["/home/runner/run.sh"]
          securityContext:
            allowPrivilegeEscalation: false
            runAsNonRoot: true
            runAsUser: 1001
            runAsGroup: 1001
            capabilities:
              drop: [ALL]
            privileged: false
            readOnlyRootFilesystem: false
          resources:
            requests:
              cpu: 250m
              memory: 512Mi
            limits:
              cpu: "1"
              memory: 1Gi
YAML
```

Publicly trusted Steward and Identity endpoints need no CA configuration. For
private PKI, reference an existing ConfigMap containing only public CA
certificates. Add exactly one `steward-run-trust-bundle` volume, mount it
read-only at `/etc/steward-run/trust`, and set
`NODE_EXTRA_CA_CERTS=/etc/steward-run/trust/ca.crt` on the complete runner
entry. The tested shape is in
[`test/fixtures/arc-ca-values.yaml`](../test/fixtures/arc-ca-values.yaml).
Never place inline PEM or a private key in values.

Use Kubernetes Pod Security Admission as a second, cluster-enforced boundary.
Before installation, create the dedicated runner namespace and label it for
the `restricted` policy. Pin `PSS_VERSION` to a supported Kubernetes minor and
advance it deliberately during cluster upgrades:

```sh
PSS_VERSION=v1.32
kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" \
  create namespace "$RUNNER_NAMESPACE" --dry-run=client -o yaml |
  kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" apply -f -
kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" \
  label namespace "$RUNNER_NAMESPACE" --overwrite \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version="$PSS_VERSION" \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/audit-version="$PSS_VERSION" \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/warn-version="$PSS_VERSION"
```

### 5. Render, install, and verify linkage

```sh
helm lint "$CHART_PACKAGE" --strict --values customer-values.yaml
helm template "$RUNNER_RELEASE" "$CHART_PACKAGE" \
  --namespace "$RUNNER_NAMESPACE" --values customer-values.yaml \
  --kube-version 1.36.0 > rendered-scale-set.yaml

helm --kubeconfig "$KUBECONFIG_FILE" --kube-context "$KUBE_CONTEXT" \
  upgrade --install "$RUNNER_RELEASE" "$CHART_PACKAGE" \
  --namespace "$RUNNER_NAMESPACE" --create-namespace \
  --values customer-values.yaml --wait --timeout 10m

node ./steward-run-arc-preflight.mjs \
  --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" \
  --namespace "$ARC_CONTROLLER_NAMESPACE" \
  --release-name "$ARC_CONTROLLER_RELEASE" \
  --runner-namespace "$RUNNER_NAMESPACE" \
  --runner-scale-set-name "$RUNNER_SCALE_SET" --output json |
  jq -e '.status == "ok" and .runnerLinkage == "verified"' >/dev/null
```

The default is zero idle runners, so an empty runner Pod list before dispatch
is expected. The listener and `AutoscalingRunnerSet` must exist.

## Network egress and proxies

Permit outbound TCP 443 only to the destinations required by the selected
installation and workload. Hostnames discovered from configuration are exact
operator-owned values; do not replace them with vendor guesses.

| Component / phase | Required destination | Purpose |
| --- | --- | --- |
| Action | Exact host in `steward-api-url` | RFC 9728 metadata and the six-operation Steward Task lifecycle |
| Action | Exact Identity issuer and `token_endpoint` hosts from validated metadata, or the explicit compatibility exchange URL | RFC 8414 metadata and token exchange |
| Action | Host in GitHub's `ACTIONS_ID_TOKEN_REQUEST_URL` (normally under `*.actions.githubusercontent.com`) | Job-scoped GitHub OIDC assertion |
| GitHub runner / reusable workflow | `github.com`, `api.github.com`, `*.actions.githubusercontent.com`, `codeload.github.com` | Runner control plane and pinned action checkout |
| Artifact transfer | `results-receiver.actions.githubusercontent.com`, `*.blob.core.windows.net` | Download the declared input artifact and upload the declared output artifact |
| ARC registration | GitHub endpoints required by ARC for the selected GitHub.com organization or repository | Listener registration and job acquisition |
| Installation only | `ghcr.io`, `pkg-containers.githubusercontent.com`, `release-assets.githubusercontent.com` | Pull the runner image, chart, and release assets |

GitHub maintains the authoritative, changeable runner-domain inventory in its
[self-hosted runner communication reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners#requirements-for-communication-with-github).
Resolve any CNAMEs according to the firewall's policy; GitHub notes that their
targets can change.

The action HTTP client honors `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`, plus
the lowercase `http_proxy`, `https_proxy`, and `no_proxy` forms. Lowercase takes
precedence when both cases are present. `NO_PROXY` is a comma- or space-separated
host list; an entry can include a port, a leading dot or `*.` for subdomains, or
`*` to bypass all proxies. The same routing applies to GitHub OIDC, both metadata
requests, Identity exchange, and every Steward API request. The private-CA
compatibility transport uses the same proxy path, follows redirects under the
same safe-origin and HTTPS checks as system trust, and keeps TLS verification
on.

For upgrades from versions before v0.7.4, proxy variables are newly honored.
Lowercase variables win over uppercase variables. Add the exact Steward and
Identity hosts to `NO_PROXY`/`no_proxy` when those services must be reached
directly; otherwise they will use the configured proxy. This applies equally
to the private-CA path, including redirected requests.

Set proxy variables before the action's Node process starts. For self-hosted
runners, follow GitHub's
[runner proxy procedure](https://docs.github.com/en/actions/how-tos/manage-runners/use-proxy-servers)
and restart the runner after changing its service environment. Containerized
runners may also require runtime-level proxy configuration. Never commit a
credential-bearing proxy URL or place one in Helm values; use the deployment's
masked environment/Secret mechanism. If TLS interception is authorized, mount
the public CA as documented above and keep `NO_PROXY` limited to destinations
that are intentionally reached directly.

## Authentication discovery contract

Production configuration supplies only `steward-api-url`. For
`https://steward.customer.example`, the action performs these two metadata
requests:

```text
GET https://steward.customer.example/.well-known/oauth-protected-resource
GET https://identity.customer.example/.well-known/oauth-authorization-server
```

The first JSON document must identify the exact resource and one issuer:

```json
{
  "resource": "https://steward.customer.example",
  "authorization_servers": ["https://identity.customer.example"]
}
```

The second must repeat the exact issuer and advertise the exchange:

```json
{
  "issuer": "https://identity.customer.example",
  "token_endpoint": "https://identity.customer.example/v1/exchange",
  "github_oidc_audience": "customer-steward-github-exchange"
}
```

Discovery compares raw strings. `steward-api-url` must equal Steward's
`taskIdentity.resource` exactly, and the advertised authorization server must
equal Identity's `issuer` exactly. A trailing slash is a different string.

`github_oidc_audience` is optional; when absent, the exact issuer URL is used.
URLs are limited to 2,048 characters and require HTTPS except for loopback
tests. Redirects, credentials, fragments, mismatches, ambiguous issuers, and
oversized metadata are rejected. Each response is capped at 64 KiB, each
request has a five-second timeout, and both requests share a ten-second
budget. Metadata responses must be exactly HTTP 200.

## Integration and object inventory

| Purpose | Object or claim | Owner |
| --- | --- | --- |
| ARC registration | Existing `Opaque` Secret in `arc-runners` with `github_app_id`, `github_app_installation_id`, and `github_app_private_key` | GitHub App / cluster operator |
| Runner image | Manifest `image`, pinned as `repository@sha256:<64 lowercase hex>` | v0.7.5 release |
| Reusable workflow | Manifest `workflowRepository` and exact 40-character `workflowCommit` | v0.7.5 release |
| Steward authentication | Job-scoped GitHub OIDC token from `id-token: write`; no static token Secret | GitHub / Identity |
| Optional public CA | Existing ConfigMap key `ca.crt`, mounted at `/etc/steward-run/trust/ca.crt` | PKI / cluster operator |
| ARC controller | Separate 0.14.2 controller and CRDs | Cluster platform operator |

### Supported upstream caller

Direct consumption of the public upstream reusable workflow is supported for
GitHub.com callers. Replace `REVIEWED_40_HEX_COMMIT` with the manifest's exact
`workflowCommit`; GitHub does not allow an expression in `jobs.<job>.uses`.

```yaml
name: Governed Steward task
on: workflow_dispatch
jobs:
  prepare:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: request
          path: request/
          if-no-files-found: error
  governed:
    needs: prepare
    permissions:
      contents: read
      id-token: write
    uses: apelogic-ai/steward-run/.github/workflows/steward-task-customer.yml@REVIEWED_40_HEX_COMMIT
    with:
      runner-label: steward-run
      workflow: CUSTOMER_WORKFLOW_REFERENCE
      input-artifact: request
      output-artifact: result
      steward-api-url: https://steward.customer.example
      job-timeout-minutes: 15
      runtime-binding-timeout-minutes: 10
```

The reusable workflow checks out its action from the immutable
`job.workflow_repository` and `job.workflow_sha` supplied by GitHub. It accepts
no PAT or checkout-token input, and it does not accept an action repository,
action ref, container image, or job-container image from the caller.

Cross-repository consumption from a different private fork is not supported:
the caller's `GITHUB_TOKEN` cannot be assumed to read that private workflow
repository, and this workflow intentionally has no credential input. Either
consume the public upstream workflow, call the workflow from the same private
repository, or vendor the reviewed workflow and action bundle into the caller
repository. Do not add a PAT without a separately reviewed authentication
design.

### Identity policy

Do not configure a `job_workflow_ref` allowlist: github-oidc-exchange policy
versions 5 and 6 have no workflow-ref or workflow-SHA selector. Version 6
binds the numeric GitHub owner and repository IDs and applies its configured
subject, event, and ref selectors. The reusable-workflow ref is retained in
issued provenance, but it is not currently an admission input.

Configure only fields present in the installed exchange policy schema, using
the caller repository's numeric IDs and exact subject/event/ref values. Keep
the literal 40-character `workflowCommit` in the caller as a separate supply-
chain pin. Do not mistake that source pin for an Identity policy control.
[github-oidc-exchange issue #82](https://github.com/apelogic-ai/github-oidc-exchange/issues/82)
tracks workflow-ref and workflow-SHA selectors. If that feature lands, follow
the exchange release's migration guidance before adding either selector.

### Task source and timeout inputs

Supply exactly one Task source:

- `workflow`: an existing governed Workflow reference; or
- `invocation-path`: a canonical checked-in direct-package manifest path.

`envelope-digest` is optional and must be
`steward:sha256:<64 lowercase hex>`. Omit it only when the authenticated owner
has exactly one active Envelope.

`job-timeout-minutes` controls the GitHub job, accepts whole minutes from 1
through 360, and defaults to 15.
`runtime-binding-timeout-minutes` controls the wait for Steward to bind a
runtime, accepts whole minutes from 1 through 360, and defaults to 10. Increase
both when expected approval or capacity waits exceed the defaults.

## Explicit exchange compatibility inputs

The explicit path remains optional and backward compatible:

| Input | Behavior |
| --- | --- |
| `identity-exchange-url` | Non-empty bypasses discovery and selects the explicit exchange endpoint. |
| `identity-exchange-audience` | Exact GitHub OIDC audience for the explicit URL. It is rejected without that URL and is not required yet. |
| `steward-ca-certificate-file` | Non-empty extends system trust with the named public CA file. |

Supplying the URL or CA-file compatibility input emits a value-free deprecation
warning. When the URL is supplied without `identity-exchange-audience`, the
action retains `apelogic-github-identity-exchange` for compatibility and emits a
separate warning that names the deprecated default but no supplied URL or
credential. Supply the exchange's exact audience now; making it required or
removing the default requires a separately reviewed major-version migration.

## Post-install

Before the first production workload:

```sh
helm --kubeconfig "$KUBECONFIG_FILE" --kube-context "$KUBE_CONTEXT" \
  status "$RUNNER_RELEASE" --namespace "$RUNNER_NAMESPACE"
kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" \
  --namespace "$RUNNER_NAMESPACE" get autoscalingrunnersets,rolebindings,serviceaccounts
```

Dispatch the pinned caller workflow and verify:

- the ARC listener creates a runner from the digest-pinned image;
- the action discovers Steward and Identity once each;
- Identity accepts the configured numeric repository/owner IDs and exact
  subject, event, ref, and audience policy;
- `status`, `task-uid`, and `runtime-uid` are populated;
- the `result` artifact contains only declared outputs; and
- Steward finalization is `confirmed`.

The mock round trip in CI proves protocol routing, not the operator's deployed
Steward, Identity, GitHub App registration, or sandbox runtime.

## Delivery tests

Release acceptance is:

- `sha256sum -c SHA256SUMS` and both blob signature verifications succeed;
- Cosign verifies the exact image and chart digests;
- the manifest lists only `linux/amd64` and `linux/arm64` runnable platforms;
- the controller preflight reports ARC 0.14.2 and exact ServiceAccount linkage;
- `helm lint` and `helm template` pass with the complete values file;
- Kubernetes 1.32, 1.33, 1.34, 1.35, and 1.36 render; 1.31 and 1.37 fail;
- an incomplete runner container overlay fails schema validation; and
- one live governed task completes and finalizes under the documented Identity
  repository/subject/event/ref policy.

## Upgrade

For an installation older than v0.6.0, migrate authentication discovery in
this order: publish Steward's protected-resource metadata and Identity's
authorization-server metadata first; upgrade while retaining the explicit
`identity-exchange-url`, `identity-exchange-audience`, and any CA-file input;
verify one governed task through that explicit path; then remove the
compatibility inputs and verify discovery. Do not remove the explicit path
before both metadata endpoints are live and exact-string compatible.

1. Download and verify the new release in a new directory.
2. Compare release notes, supported Kubernetes/ARC versions, manifest
   `workflowCommit`, `actionCommit`, image digest, and chart digest.
3. Replace `IMAGE_REFERENCE` in the complete values file.
4. Update the caller's literal workflow commit. Identity v5/v6 has no
   workflow-ref selector, so there is no corresponding allowlist entry.
5. Lint, render, run controller preflight, then upgrade:

```sh
helm --kubeconfig "$KUBECONFIG_FILE" --kube-context "$KUBE_CONTEXT" \
  upgrade "$RUNNER_RELEASE" "$CHART_PACKAGE" \
  --namespace "$RUNNER_NAMESPACE" --values customer-values.yaml \
  --wait --timeout 10m
```

6. Repeat runner-linkage preflight and the live delivery test. Keep the prior
   manifest, chart package, values, commit, and Helm revision for rollback.

GitHub requires self-hosted runners to be updated within 30 days of a new
runner release. Immutable images do not self-update; fork and mirror operators
must rebuild, verify, and roll out replacement digests within that window.

## Rollback

Restore the previous release as one coherent unit: previous chart package,
image digest, and reusable-workflow commit. Restore Identity policy only when
the release migration actually changed a supported policy field.
Do not roll back only the image or only the workflow.

The v0.7.4 image contains the affected OpenSSL packages described in the
v0.7.5 release notes. Rolling back to it reintroduces CVE-2026-75803; do so
only under an explicit incident/security decision and upgrade again promptly.

```sh
helm --kubeconfig "$KUBECONFIG_FILE" --kube-context "$KUBE_CONTEXT" \
  history "$RUNNER_RELEASE" --namespace "$RUNNER_NAMESPACE"
helm --kubeconfig "$KUBECONFIG_FILE" --kube-context "$KUBE_CONTEXT" \
  rollback "$RUNNER_RELEASE" PREVIOUS_REVISION \
  --namespace "$RUNNER_NAMESPACE" --wait --timeout 10m
```

Re-run the linkage preflight and delivery test after restoring the caller pin
and Identity policy. Preserve any CA ConfigMap until no running or rollback
revision references it.

To uninstall only steward-run:

```sh
helm --kubeconfig "$KUBECONFIG_FILE" --kube-context "$KUBE_CONTEXT" \
  uninstall steward-run --namespace "$RUNNER_NAMESPACE" --wait
```

Uninstalling steward-run does not remove the shared ARC controller, its CRDs,
the operator-owned GitHub App Secret, or an operator-owned CA ConfigMap.
