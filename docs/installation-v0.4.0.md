# steward-run v0.4.0 installation guide

This guide installs a fork-built `steward-run` runner scale set. The runner
image and action are this product; the ARC controller, GitHub registration,
customer Steward API, and GitHub OIDC exchange are external. There is no
long-running steward-run API service. The chart path and image build below
have passed offline render and local image smoke tests. The
[`steward-task-customer.yml`](../.github/workflows/steward-task-customer.yml)
reusable workflow is statically tested but registration and a real governed
job are **not yet live-tested**. Do not treat this guide as delivery
acceptance until the last section is run against real customer endpoints.

## Prerequisites

- GitHub.com organization or repository with Actions enabled. GitHub
  Enterprise Server is not covered: the fork-self-pinned reusable
  workflow uses GitHub.com `job.workflow_repository` and `job.workflow_sha`.
- Kubernetes `1.30`–`1.34` with `linux/amd64` or `linux/arm64` schedulable
  nodes, Helm `3.17+`,
  `kubectl`, Node.js 24, a multi-node Docker Buildx builder backed by native
  `linux/amd64` and `linux/arm64` workers, and an OCI registry controlled
  by the customer. The chart declares this Kubernetes range; live compatibility
  across all versions has not been established.
- Upstream ARC controller chart `gha-runner-scale-set-controller` `0.14.2`
  installed in a separate controller namespace, with its CRDs ready. This
  product chart pins upstream `gha-runner-scale-set` `0.14.2`; it does not
  install or remove the shared controller.
- Customer Steward HTTPS API implementing
  [`/v1/tasks`](../contracts/steward-run-v1.openapi.yaml) and a customer GitHub
  OIDC exchange HTTPS endpoint. The exchange must accept the configured exact
  GitHub `aud`, validate caller and reusable-workflow identity, and return a
  short-lived token whose sole audience is `steward-task-api` (lifetime at
  most one hour). The action requires HTTPS except loopback tests.
- DNS, TLS, and egress from runner Pods to GitHub API/Actions, the image
  registry, Steward, and the exchange. Use a public CA, or install a customer
  CA bundle as described below. No Jira, AWS, ApeLogic registry, or ApeLogic
  repository is required for the fork build/install procedure.

Compatibility evidence for this source revision: Helm schema/render test of
the installable chart with ARC scale-set `0.14.2`; CI image build/smoke for
`linux/amd64` and `linux/arm64` using GitHub runner `2.336.0` with Node
`24.18.1`; mock GitHub Actions
OIDC and `/v1/tasks` contract tests. No real GitHub App registration or
Steward/identity integration result has been recorded for this guide. Publish
that evidence, tested Kubernetes patch versions, controller and scale-set
chart versions, image digest, action/workflow commits, Steward and identity
revisions before declaring a release compatible.

The multi-platform claim applies to the fork-owned
`steward-task-customer.yml` path, which runs directly in this runner image.
The legacy ApeLogic `steward-task.yml` remains `linux/amd64`-only because it
separately pins an amd64 governed job-container image; it is not the customer
handoff workflow.

Use an explicit, task-owned kubeconfig and context for every command below:

```sh
KUBECONFIG_FILE=/absolute/path/to/customer-kubeconfig
KUBE_CONTEXT=customer-cluster-context
kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" cluster-info
```

Never substitute a local ApeLogic `stable` or `main` lane kubeconfig. Keep
credential files outside the repository, mode `0600`, and never print Secret
data, private keys, OIDC tokens, or Task response bodies as evidence.

## Integration and object inventory

| Purpose | Object / type, namespace, keys | Required | Owner and rotation |
| --- | --- | --- | --- |
| ARC registration | `steward-run-github-app`, `Opaque` Secret in `arc-runners`; `github_app_id`, `github_app_installation_id`, `github_app_private_key` | Yes for recommended GitHub App path | Customer GitHub App owner creates/rotates; chart references, never creates it. IDs and PEM come from GitHub, not random generation. |
| Private registry pull | Customer-named `kubernetes.io/dockerconfigjson` Secret in `arc-runners`; `.dockerconfigjson`, referenced by `imagePullSecrets` | Only for private image registry | Registry owner creates/rotates; chart references. Publicly pullable images need none. |
| Steward/identity TLS trust | Customer-named ConfigMap in `arc-runners`; `ca.crt` public PEM bundle | Only for non-public/customer CA | Customer PKI owner creates/rotates. CA certificate comes from PKI, not random generation; not a private credential. |
| Task submission | GitHub Actions job-scoped OIDC token via `id-token: write`; no Kubernetes object | Yes at job time | GitHub issues/rotates automatically; do not install a static bearer Secret. |

The ARC registration App above is **not** Steward's optional read-only source
App, a downstream MCP-GW OAuth client, or the GitHub Actions OIDC token. Those
belong to their respective products and are not created by this chart. The
upstream ARC chart also creates listener/configuration objects and service
accounts/RBAC, but no customer private key is rendered when
`githubConfigSecret` names an existing Secret. The customer chart creates no
shared ARC controller or CRDs. The inventory is checked against chart render
and action input names by CI; real creation/rotation still needs a customer
cluster acceptance run.

## Installation

### 1. Prepare an exact fork revision and build its image

Fork the repository to a customer-owned GitHub repository and check out a
reviewed 40-character commit. Record the commit, package lock, base-image
digests, scan result, build provenance, and SBOM. The Dockerfile pins both
base images and does **not** perform an unbounded package upgrade. Rebuilds
still depend on the exact build toolchain and registry; compare evidence, not
just a mutable tag.

```sh
test -z "$(git status --porcelain)"
SOURCE_COMMIT="$(git rev-parse HEAD)"
npm ci
npm run check
FORK_REPOSITORY=customer/steward-run
IMAGE_REPOSITORY=registry.customer.example/steward-run
SOURCE_VERSION="$(node -p 'require("./package.json").version')"
docker buildx build --platform linux/amd64,linux/arm64 \
  --build-arg "VERSION=$SOURCE_VERSION" \
  --build-arg "REVISION=$SOURCE_COMMIT" \
  --build-arg "SOURCE_REPOSITORY=https://github.com/$FORK_REPOSITORY" \
  --tag "$IMAGE_REPOSITORY:$SOURCE_VERSION" \
  --provenance=mode=max \
  --attest "type=sbom,generator=docker.io/docker/buildkit-syft-scanner@sha256:ae4f3b554449e7e25548e7d8ccc029d17357348e30c6e3df01b92bc93654d6a9" \
  --metadata-file customer-build-metadata.json --push .
IMAGE_DIGEST="$(node -p 'require("./customer-build-metadata.json")["containerimage.digest"]')"
```

Verify `IMAGE_DIGEST` has the form `sha256:` plus 64 lowercase hex characters;
verify the referenced multi-platform OCI index contains exactly one
`linux/amd64` and one `linux/arm64` runnable manifest. The chart is
architecture-neutral: it pins this index digest and Kubernetes selects the
matching Linux image for each runner node. Do not replace the index digest
with a per-platform child-manifest digest in shared values:

```sh
docker buildx imagetools inspect "$IMAGE_REPOSITORY@$IMAGE_DIGEST" \
  --raw > customer-image-index.json
node scripts/verify-runnable-image-platforms.mjs \
  customer-image-index.json linux/amd64 linux/arm64
```

Retain vulnerability-policy results for each runnable child manifest and
customer signing evidence for
`$IMAGE_REPOSITORY@$IMAGE_DIGEST`. The image is a thin ARC runner with Bash,
Node, Git, and tar; action code is not baked into it. Package and publish the
exact chart independently; the external `customer-values.yaml` is prepared
and validated in step 4:

```sh
helm dependency build charts/steward-run-arc
helm package charts/steward-run-arc --destination dist
helm push dist/steward-run-arc-0.1.0.tgz oci://registry.customer.example/charts
```

The resulting chart coordinate is
`oci://registry.customer.example/charts/steward-run-arc:0.1.0`. Record its OCI
digest and package SHA-256; do not substitute an ApeLogic artifact. The chart
package contains its pinned upstream dependency. License review before
redistribution: this source is MIT; ARC's chart/controller is Apache-2.0;
`actions-runner` and `runner-container-hooks` are MIT; Node and Debian/Ubuntu
packages retain their own notices. Preserve upstream license notices and
review the final SBOM for your registry distribution policy.

### 2. Create and install the ARC registration GitHub App

Follow [GitHub's ARC authentication guide](https://docs.github.com/en/actions/how-tos/manage-runners/use-actions-runner-controller/authenticate-to-the-api)
and [App registration guide](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app).
Create an organization-owned App. For organization runners, grant repository
`Metadata: read-only` and organization `Self-hosted runners: read and write`.
For repository runners, additionally grant repository `Administration: read
and write`. Disable webhook delivery if not used. On the App settings page,
copy **App ID** to a protected local text file; generate/download its PEM
private key to a protected local file. Select **Install App**, install it on
the target organization, and limit repository access to the repositories that
will use this scale set. The installation settings URL contains the numeric
installation ID; copy only that ID to another protected local text file.
Neither ID is a random value and neither is the OAuth client ID. Keep the PEM
private key out of Git, terminal output, and Helm values.

For `githubConfigUrl`, use exactly `https://github.com/ORG` for organization
runners or `https://github.com/ORG/REPO` for repository runners. Enterprise
scope is not supported by the recommended App path. The App installation's
repository scope must include the selected repository.

### 3. Create registration and conditional trust objects

Create `arc-runners` (the controller stays in its own namespace), then make
the App Secret from real GitHub-provided files. `kubectl` reports only the
object name. Preserve the source files at mode `0600` for controlled rotation.

```sh
kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" \
  create namespace arc-runners
chmod 600 ./private/github-app-id.txt ./private/github-app-installation-id.txt ./private/github-app.pem
kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" -n arc-runners \
  create secret generic steward-run-github-app \
  --from-file=github_app_id=./private/github-app-id.txt \
  --from-file=github_app_installation_id=./private/github-app-installation-id.txt \
  --from-file=github_app_private_key=./private/github-app.pem
```

For rotation, create a new PEM in GitHub while the old key remains valid,
update the protected file, and use a file-only client-side apply; then run a
new registration job before revoking the old key. Do not emit the manifest:

```sh
kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" -n arc-runners \
  create secret generic steward-run-github-app \
  --from-file=github_app_id=./private/github-app-id.txt \
  --from-file=github_app_installation_id=./private/github-app-installation-id.txt \
  --from-file=github_app_private_key=./private/github-app.pem \
  --dry-run=client -o yaml | \
kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" -n arc-runners apply -f -
```

If the image registry is private, create a registry pull Secret in
`arc-runners` using the registry's documented credential flow and put its
existing name in `imagePullSecrets`. Never place registry credentials in
Helm values. If Steward or the exchange uses a customer CA, install the
public PEM bundle from customer PKI, and rotate it with the same dry-run/apply
pattern:

```sh
kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" -n arc-runners \
  create configmap steward-run-ca --from-file=ca.crt=./public/customer-ca.crt
kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" -n arc-runners \
  create configmap steward-run-ca --from-file=ca.crt=./public/customer-ca.crt \
  --dry-run=client -o yaml | \
kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" -n arc-runners apply -f -
```

### 4. Configure and install the product chart

Verify the shared ARC controller `0.14.2` Deployment and CRDs before
installing this chart. Record its actual service account name and namespace;
set `controllerServiceAccount` explicitly for reproducible offline rendering.

```sh
kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" \
  -n arc-system get deployment,serviceaccount
kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" \
  get crd autoscalingrunnersets.actions.github.com
```

Copy `charts/steward-run-arc/values.yaml` to `customer-values.yaml`. Under
`gha-runner-scale-set`, set `githubConfigUrl`,
`githubConfigSecret: steward-run-github-app`, and the runner container
`image: "$IMAGE_REPOSITORY@$IMAGE_DIGEST"` (substitute the literal resolved
reference; Helm does not expand shell variables in YAML). Set
`controllerServiceAccount.namespace/name` to the actual controller account.
Keep `runnerScaleSetName: steward-run`, `scaleSetLabels: [steward-run]`,
`minRunners: 0`, and a capacity-appropriate `maxRunners` (default 5).
The runner uses the upstream no-permission service account with token mounting
disabled. Keep the default non-root security and resource requests/limits.
Helm replaces lists in values overlays: when overriding `containers`, copy
the complete runner container entry, not only its image field.

For a private registry, set `template.spec.imagePullSecrets` to the existing
Secret name. For a customer CA, add a `configMap` volume named
`steward-run-ca` with `name: steward-run-ca` and a corresponding runner
`volumeMount` at `/etc/steward-run` (`readOnly: true`); keep the whole
container entry. The action input path is `/etc/steward-run/ca.crt`. This
mount is conditional; public-CA installations should leave it absent.
The tested [CA values example](../test/fixtures/arc-ca-values.yaml) shows the
complete list entries; replace its example URL, image digest, and controller
account with real customer values before use.

```sh
helm dependency build charts/steward-run-arc
helm lint charts/steward-run-arc --strict --values customer-values.yaml
helm template steward-run charts/steward-run-arc --namespace arc-runners \
  --values customer-values.yaml > rendered-scale-set.yaml
helm --kubeconfig "$KUBECONFIG_FILE" --kube-context "$KUBE_CONTEXT" \
  install steward-run charts/steward-run-arc -n arc-runners \
  --values customer-values.yaml
```

The rendered file contains references and public configuration, not the App
private key. Review it for the exact `AutoscalingRunnerSet`, image digest,
Secret references, service account, and absence of controller resources.

## Post-install

The listener should be Running at zero idle runners; runner Pods appear when
a job is assigned. Confirm the scale set, name/labels, App reference, image
pull success, scheduling, and GitHub registration without reading Secret data:

```sh
kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" -n arc-runners \
  get autoscalingrunnersets.actions.github.com,autoscalinglisteners.actions.github.com,pods
kubectl --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" -n arc-runners \
  describe autoscalingrunnerset steward-run
```

In GitHub **Settings → Actions → Runners**, confirm the `steward-run` scale
set is registered at the selected repository/organization. Run the
[`steward-task-customer.yml`](../.github/workflows/steward-task-customer.yml)
reusable workflow at an exact reviewed fork commit. It uses `job.workflow_repository`
and `job.workflow_sha` to check out its own action under
`.steward-run-action`, rejects a caller repository that already occupies that
path, and never accepts a caller-selected executable action ref or job image.
The action stays in the digest-pinned ARC runner Pod; no ECR job container is
needed. GitHub Enterprise Server is not covered because those job contexts
are not available there. Make the fork accessible to the caller as required
by GitHub's reusable-workflow and repository checkout access policies.

Check a caller workflow into the approved repository. The first job uploads
a known `request/` directory as the `request` artifact; the governed job
downloads it under `in/` and uploads `out/` as `result`. Replace every
`CUSTOMER_*` and `REVIEWED_40_HEX_COMMIT` example below with reviewed values,
including the real Steward Workflow reference. The `uses` commit must be a
literal 40-character SHA in the checked-in caller workflow, not an expression
or moving tag. Review changes to this caller workflow: its current exchange
contract accepts an endpoint and audience supplied by the caller. Further
trust hardening is tracked in [issue #43](https://github.com/apelogic-ai/steward-run/issues/43),
outside this installation slice.

```yaml
name: Governed Steward delivery test
on: workflow_dispatch
jobs:
  prepare:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: request
          path: request/
          if-no-files-found: error
  governed:
    needs: prepare
    permissions:
      contents: read
      id-token: write
    uses: CUSTOMER_ORG/steward-run/.github/workflows/steward-task-customer.yml@REVIEWED_40_HEX_COMMIT
    with:
      runner-label: steward-run
      workflow: CUSTOMER_WORKFLOW_REFERENCE
      input-artifact: request
      output-artifact: result
      steward-api-url: https://steward.customer.example
      identity-exchange-url: https://identity.customer.example/v1/exchange
      identity-exchange-audience: CUSTOMER_EXACT_GITHUB_OIDC_AUDIENCE
      # Set steward-ca-certificate-file: /etc/steward-run/ca.crt only when mounted.
```

Supply either `workflow` as above or `invocation-path` to a checked-in
manifest, never both. For `invocation-path`, the customer workflow checks out
the caller's exact triggering commit without persisting credentials; Steward
must separately authorize and fetch that same source. The action exchanges
GitHub's job-scoped OIDC token for a short-lived `steward-task-api` token; it
does not use the GitHub App registration Secret. Inspect the job's `status`,
`task-uid`, and `runtime-uid` outputs and the `result` artifact without
printing token material. This workflow has not yet been exercised against a
customer ARC registration and Steward/identity deployment; the delivery
tests below remain mandatory. Do not use the ApeLogic-pinned workflows for
this installation.

## Upgrade

Build, scan, and publish the new fork image; record its new digest and source
commit. Review upstream ARC and chart compatibility. Update the literal
digest in the full runner entry of `customer-values.yaml`, render/lint, and
upgrade only the product release. Run the delivery checks on new ephemeral
runners; keep the previous values, image digest, and chart package as rollback
evidence.

```sh
helm --kubeconfig "$KUBECONFIG_FILE" --kube-context "$KUBE_CONTEXT" \
  upgrade steward-run charts/steward-run-arc -n arc-runners \
  --values customer-values.yaml
helm --kubeconfig "$KUBECONFIG_FILE" --kube-context "$KUBE_CONTEXT" \
  history steward-run -n arc-runners
```

## Rollback and uninstall

Select the known-good Helm revision from `helm history` and roll back this
release only. Verify listener and newly scheduled runner image digest again.

```sh
helm --kubeconfig "$KUBECONFIG_FILE" --kube-context "$KUBE_CONTEXT" \
  rollback steward-run PREVIOUS_REVISION -n arc-runners
helm --kubeconfig "$KUBECONFIG_FILE" --kube-context "$KUBE_CONTEXT" \
  uninstall steward-run -n arc-runners
```

Uninstall removes this product's upstream scale-set resources. It **does not
remove** the shared ARC controller, its CRDs, the operator-owned App Secret,
registry pull Secret, or CA ConfigMap. Remove those operator objects only
after checking that no other scale set uses them.

## Delivery tests

These are required release acceptance checks, not results asserted by this
guide. The integration owner supplies exact customer image/chart digests,
GitHub App installation, Steward and identity revisions/URLs, OIDC audience,
test repository, and a disposable task invocation with known output. Save
only source revisions, artifact digests, resource names/status, job run IDs,
Task UIDs, and bounded outcome categories.

| Check / action | Expected result and non-secret evidence |
| --- | --- |
| `helm lint` and `helm template` above; inspect `rendered-scale-set.yaml` | Exactly one ARC `AutoscalingRunnerSet` with fork image `@sha256`, expected App Secret name, scale-to-zero and security values; no controller Deployment/CRD or key bytes. Record chart digest and render check result. |
| `kubectl ... get autoscalingrunnersets.actions.github.com,autoscalinglisteners.actions.github.com,pods -n arc-runners` | Scale set exists, listener ready; at idle, zero runner Pods is normal. Record statuses and selected controller/scale-set chart versions. |
| In GitHub Actions, dispatch a real job on `steward-run`; watch `kubectl ... get pods -n arc-runners -w` | GitHub queues and assigns the job; a Pod using the fork-owned digest pulls and runs, then disappears. Record job run ID, Pod phase, and image digest only. |
| Run a governed job with the fork-pinned workflow/action, customer endpoints, `id-token: write`, and known input/output artifact | Identity exchange issues a short-lived `steward-task-api` token; Steward Task succeeds and finalizes; output artifact matches expected hash. Record bounded Task UID/status/finalization and job run ID, never token or response bodies. **Pending live test.** |
| Repeat with a deliberately wrong OIDC audience; repeat with an untrusted CA or hostname | Both fail closed before a successful Task submission. Record only safe authentication/TLS failure category and absence of a completed Task. **Pending live test.** |
| Run App-key and CA creation/rotation steps with a new valid credential/certificate, then another registration/job | New runner registers and task succeeds before old key is revoked; no Secret data appears in logs or evidence. **Pending live test.** |
| Uninstall only `steward-run`, then check controller Deployment and CRDs | Product scale set/listener gone; shared controller/CRDs still present. Record resource names/status. **Pending live test.** |

CI checks chart values, upstream Secret key names, action inputs, README link,
and dry-run creation/rotation syntax; it cannot prove GitHub registration or
external Steward/identity behavior. An outdated README or unrun delivery
checklist blocks claiming issue #41 complete.
