# steward-run installation and integration

This is the current installation contract for source after v0.5.0. The
[v0.5.0 guide](installation-v0.5.0.md) remains immutable historical evidence.
Use a tagged release that includes this document; never combine a workflow,
chart, action, and runner image from different releases.

## Prerequisites

- GitHub.com Actions with `id-token: write` and an exact 40-character commit
  pin for the reusable workflow.
- A Steward Task API that publishes RFC 9728 protected-resource metadata.
- An Identity issuer that publishes RFC 8414 authorization-server metadata
  and accepts GitHub OIDC assertions at its advertised `token_endpoint`.
- Node.js 24 in the runner, or the released multi-platform runner image.
- For ARC: Kubernetes 1.30–1.34, Helm 3.17+, upstream ARC 0.14.2, an
  operator-owned GitHub registration Secret, and a runner image pinned by OCI
  digest. Follow the complete ARC registration, artifact verification, and
  release-selection procedure in the historical guide, substituting one
  coherent newer release.

The action, reusable workflows, image, and chart contain no Steward token,
GitHub App key, registry credential, CA certificate content, or private key.

## Authentication discovery contract

The only production topology input is `steward-api-url`. Given the canonical
resource `https://steward.customer.example/api`, the action performs at most
these two unauthenticated metadata requests:

```text
GET https://steward.customer.example/.well-known/oauth-protected-resource/api
GET https://identity.customer.example/.well-known/oauth-authorization-server
```

The first response must be `application/json`, identify the exact resource,
and list exactly one authorization server:

```json
{
  "resource": "https://steward.customer.example/api",
  "authorization_servers": ["https://identity.customer.example/"]
}
```

The second response must repeat the exact issuer and advertise the exchange:

```json
{
  "issuer": "https://identity.customer.example/",
  "token_endpoint": "https://identity.customer.example/v1/exchange",
  "github_oidc_audience": "customer-steward-github-exchange"
}
```

`github_oidc_audience` is optional. If omitted, the exact canonical issuer URL
is the GitHub OIDC audience. No other audience fallback exists. Path-bearing
resource and issuer URLs use the RFC 9728 and RFC 8414 insertion rules; the
action never guesses a sibling hostname or endpoint path.

Each URL is limited to 2,048 characters and must use HTTPS, except for explicit
loopback tests. Credentials and fragments are rejected; issuer URLs also
reject queries. Metadata redirects are rejected, each response is limited to
64 KiB, each request has a five-second timeout, and the complete two-request
discovery has a ten-second budget. A successful result is cached for the
action process; a failed result is not. The action then requests GitHub OIDC
for the exact selected audience, POSTs that assertion to `token_endpoint`,
and accepts only the existing short-lived `steward-task-api` token contract.
Every Task request still targets the original `steward-api-url`.

## Minimal reusable-workflow integration

This is the preferred caller. Replace the placeholders and pin `uses` to the
exact release or reviewed fork commit containing this contract:

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
    uses: CUSTOMER_ORG/steward-run/.github/workflows/steward-task-customer.yml@REVIEWED_40_HEX_COMMIT
    with:
      runner-label: steward-run
      workflow: CUSTOMER_WORKFLOW_REFERENCE
      input-artifact: request
      output-artifact: result
      steward-api-url: https://steward.customer.example/api
```

The supported `steward-task.yml`, `steward-task-self-hosted.yml`, and
`steward-task-customer.yml` workflows all declare the three compatibility
inputs below as optional strings with `default: ""`. Direct OIDC and bearer-
file inputs are not exposed by these public production workflows.
The customer workflow checks out its own action from the exact
`job.workflow_repository` and `job.workflow_sha` supplied by GitHub, so callers
cannot select executable code. GitHub Enterprise Server is not covered because
those reusable-workflow job context fields are not available there.

## Deprecated compatibility inputs

Existing callers do not have to change during upgrade. An explicit exchange
URL bypasses discovery and preserves the prior behavior; an explicit audience
selects the exact GitHub OIDC audience for that endpoint. An audience without
an explicit URL is rejected. If the URL is supplied while the audience remains
empty, the historical `apelogic-github-identity-exchange` audience is retained.
A CA file extends system trust for Steward,
metadata, and exchange requests. Each supplied compatibility input emits a
warning containing only its input name, never its value or certificate data.

```yaml
  governed:
    permissions:
      contents: read
      id-token: write
    uses: CUSTOMER_ORG/steward-run/.github/workflows/steward-task-customer.yml@REVIEWED_40_HEX_COMMIT
    with:
      runner-label: steward-run
      workflow: CUSTOMER_WORKFLOW_REFERENCE
      input-artifact: request
      output-artifact: result
      steward-api-url: https://steward.customer.example/api
      identity-exchange-url: https://identity.customer.example/v1/exchange
      identity-exchange-audience: customer-steward-github-exchange
      steward-ca-certificate-file: /etc/steward-run/trust/ca.crt
```

These inputs cannot be removed without a separately reviewed major-version
contract and migration plan:

| Input | Default | Precedence |
| --- | --- | --- |
| `identity-exchange-url` | `""` | Non-empty selects explicit exchange and skips discovery. |
| `identity-exchange-audience` | `""` | Used only with a non-empty explicit exchange URL; empty retains the historical audience. |
| `steward-ca-certificate-file` | `""` | Non-empty extends process trust; empty uses normal system trust. |

## ARC installation and optional public CA bundle

Publicly trusted Steward and Identity endpoints require no CA values, volumes,
or environment variables. For a private PKI, create an operator-owned
ConfigMap containing only public CA certificates:

```sh
kubectl -n arc-runners create configmap steward-run-ca \
  --from-file=ca.crt=./public/customer-ca.crt
```

In the `steward-run-arc` values overlay, add this exact shape to the complete
runner Pod template. The chart validates the reference, one-key projection,
read-only mount, and Node trust path at render time:

```yaml
gha-runner-scale-set:
  template:
    spec:
      volumes:
        - name: steward-run-trust-bundle
          configMap:
            name: steward-run-ca
            items:
              - key: ca.crt
                path: ca.crt
      containers:
        - name: runner
          # Preserve the complete released image, command, security, and resources block.
          image: registry.customer.example/steward-run@sha256:RELEASED_64_HEX_DIGEST
          env:
            - name: NODE_EXTRA_CA_CERTS
              value: /etc/steward-run/trust/ca.crt
          volumeMounts:
            - name: steward-run-trust-bundle
              mountPath: /etc/steward-run/trust
              readOnly: true
```

`NODE_EXTRA_CA_CERTS` adds this bundle to Node's normal system roots before the
action starts. Do not put PEM contents or a private key in values. The complete
tested overlay is [the ARC CA fixture](../test/fixtures/arc-ca-values.yaml).

Custom wrappers using the `steward-run` library chart can instead set:

```yaml
stewardRun:
  trustBundle:
    configMapName: steward-run-ca
    key: ca.crt
```

Render before applying:

```sh
helm lint steward-run-arc-RELEASE.tgz --strict --values customer-values.yaml
helm template steward-run steward-run-arc-RELEASE.tgz \
  --namespace arc-runners --values customer-values.yaml > rendered-scale-set.yaml
```

## Upgrade and rollback

Upgrade order is behavior-preserving:

1. Deploy Steward and Identity metadata that passes the contract above.
2. Upgrade the runner image, chart, and reusable-workflow commit as one release.
3. Leave existing explicit inputs in place and run one governed task; it must
   use the compatibility path without a discovery request.
4. Remove the three compatibility inputs in a reviewed workflow change and
   run another task; it must discover once and complete against the same
   original Steward resource.
5. Retain the prior workflow commit, image digest, chart package, and values.

If discovery fails, restore the explicit endpoint/audience inputs; no server or
data rollback is required. To roll back the runner release, restore the prior
workflow commit and verified image/chart together. If the trust-bundle shape
was added, either keep it (older releases still accept the explicit CA-file
path) or restore the prior Pod template and explicit path together. Do not
remove the operator-owned ConfigMap until no running or rollback runner uses
it.

## Verification

- `helm lint` and `helm template` pass with no trust volume for public PKI.
- The private-PKI render contains exactly one ConfigMap volume, one read-only
  mount, and one `NODE_EXTRA_CA_CERTS` entry; an empty/invalid name fails.
- The minimal workflow emits no compatibility warning and performs exactly one
  protected-resource and one Identity discovery request per action process.
- The compatibility workflow emits only fixed input-name warnings and makes no
  discovery request.
- Wrong resource/issuer, multiple issuers, redirect, non-loopback HTTP,
  malformed/oversized metadata, wrong OIDC audience, wrong token audience,
  expired token, untrusted CA, and hostname mismatch all fail before a Task is
  successfully submitted.

## Documentation inventory

| Current surface | Status |
| --- | --- |
| Root README and action input reference | Updated for discovery, precedence, deprecation, and system trust. |
| Three supported reusable workflows | Optional empty defaults; internal direct-token modes remain absent. |
| This installation/integration guide | Canonical copy-ready discovered and compatibility examples. |
| `docs/steward-run-spec.md` | Exact metadata, bounds, precedence, and token contract. |
| Application and library chart READMEs/values/schema | Public-trust default and ConfigMap-backed bundle documented and tested. |
| `CHANGELOG.md` and unreleased notes | Upgrade and rollback behavior recorded. |
| `docs/installation-v0.5.0.md` | Historical; marked superseded and otherwise unchanged. |
| ARC preflight and vulnerability/security documents | Unaffected: they do not define task authentication or trust values. |
