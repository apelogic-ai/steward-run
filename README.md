# steward-run

`steward-run` is the environment-agnostic GitHub Action and ARC runner image that translates a
live GitHub Actions job into a governed Steward Task. The workspace is the only workflow
author-facing data contract.

The [v0.7.6 installation, setup, and integration guide](docs/installation.md)
describes the current release contract. The [v0.5.0 guide](docs/installation-v0.5.0.md) is the
authoritative guide for v0.5.0, which predates authentication discovery and
requires the explicit Identity exchange inputs.
Operators publishing an independent distribution should follow the
[fork, rebuild, and publish procedure](docs/customer-rebuild.md); it defines
the separate workflow identity, OCI coordinates, package visibility, and
verification handoff a fork must own.
Before registration or scale-set installation, run the released
[read-only ARC controller preflight](docs/arc-controller-preflight.md) to verify
the exact controller release, ServiceAccount, and supported ARC version.
The product is [MIT licensed](LICENSE): this repository owns the runner image,
composite action, reusable workflow sources, and installable
[`steward-run-arc` chart](charts/steward-run-arc/). The ARC controller and GitHub
runner registration API are external prerequisites; this is not a separate
long-running Steward API service. Release `v0.7.6` publishes the standalone
multi-platform runner at `ghcr.io/apelogic-ai/steward-run:0.7.6` and the
application chart in
`oci://ghcr.io/apelogic-ai/charts/steward-run-arc` at version `0.7.6`; the
[Artifact Hub package](https://artifacthub.io/packages/helm/steward-run/steward-run-arc)
indexes the same OCI repository. The
attached `oss-release-manifest.json` records both immutable OCI digests, the
pinned reusable-workflow and action commits, workflow repository, ARC
compatibility version, release-asset checksums, embedded BuildKit SLSA
provenance and SPDX SBOM evidence, and keyless signature bundles.
These embedded OCI attestations are not GitHub artifact attestations and are
not consumed by `gh attestation verify`. The manifest's schema-3 `image` field
is the signed public image mapped into Steward's `governedJobContainerImage`
and the exact digest embedded in the container-based reusable workflow. The
pre-tag image is promoted unchanged to the release version tag.

The client implements Steward's six-operation `/v1/tasks` lifecycle documented in
`contracts/steward-run-v1.openapi.yaml`. It submits, uploads a workspace-relative tar archive,
requests execution, polls through approval parking to a terminal phase, downloads declared
outputs, and always requests finalization.

Failed runs publish the bounded `steward-run.failure/v1` contract as both a GitHub error
annotation and step summary. The visible fields are only terminal phase, an allowlisted failure
category, and an independent finalization category. Raw Steward reasons, response data,
stdout/stderr, headers, tokens, assertions, credentials, and Secret values are never copied into
GitHub metadata or the terminal error. Unknown details map to `unknown`; successful runs do not
publish failure metadata.

The action and all three reusable workflows in this source tree also emit
bounded `outcome`, `failure-category`, and `http-status` step outputs.
`outcome` is exactly `success` or `failure`; the other two are empty when not
applicable. Existing `status`, `task-uid`, and `runtime-uid` retain their
meanings. A calling job that needs to inspect failure outputs must give the
action step `continue-on-error: true` and branch on those bounded values; no
response body or credential is exposed.

When a Steward API request itself fails, the existing failure contract is accompanied by
`steward-run.request-failure/v1`. That bounded signal identifies the request stage and category,
plus the numeric HTTP status and a syntactically constrained `X-Correlation-ID` or `X-Request-ID`
when the response supplies them. Submit failures distinguish validation (400/422), authentication
(401), authorization (403), conflict (409), dependency failures (including 503), timeout,
transport, and malformed successful responses. Failure response bodies and all other headers are
ignored.

An Identity exchange 400, 401, or 403 is attempted once and reported at the
bounded `exchange` request stage. A 401 is `authentication`, a 403 is
`authorization`, and `http-status` retains the exact status. The fixed
`steward-run.identity-exchange/v1` diagnostic tells operators to check the
Identity policy repository, subject, event, and ref selectors; it never emits
the OAuth response body or token. Exchange 429, 5xx, and network failures
remain retryable.

Governed smoke workflows may use the exact agent exit codes 70–75 for
`provider-connection`, `provider-token-grant`, `provider-authorization`, `provider-upstream`,
`assertion-mismatch`, and `workflow-cleanup`, respectively. Exact agent exit 76 maps to
`provider-grant`, which identifies an absent or incomplete local provider OAuth grant before a
provider-backed request. Exact agent exit 77 maps to `provider-protocol`, which identifies a local
MCP framing, JSON-RPC, or session-contract failure after the provider has authenticated. Except
for the staged assertion exits described below, any other numeric agent exit maps to `execution`.
Steward finalization is reported separately as `confirmed`,
`not-required`,
`request-failed`, `confirmation-timeout`, `identity-mismatch`, or `unknown`.

Assertion failures may use exact agent exits 78 through 81. They retain the existing
`assertion-mismatch` failure category and additionally publish one bounded
`steward-run.assertion-stage/v1` signal: 78 is `input-request`, 79 is
`runtime-toolchain`, 80 is `model-result`, and 81 is `mcp-tool-event`. Legacy exact exit 74 remains
`assertion-mismatch` without a stage signal. The original `steward-run.failure/v1` annotation and
summary row remain unchanged; a staged assertion adds a second bounded annotation and summary
row. Malformed reasons and any other numeric exits cannot select an assertion stage.

Production authentication starts from `steward-api-url`. The action reads
RFC 9728 protected-resource metadata, requires exactly one trusted Identity
issuer, reads its RFC 8414 metadata, requests a GitHub OIDC assertion for the
advertised `github_oidc_audience` (or the exact issuer URL when that field is
absent), and exchanges it for a short-lived token whose sole audience is
`steward-task-api`. No Identity hostname or path is inferred. The mock round
trip proves this routing but does not prove a deployed Steward control plane,
Identity service, or Agent Sandbox.

## Development

Requires Node.js 24, Docker, and Helm 3.17 or later for the Kubernetes chart
render check.

```console
npm ci
npm run check
```

Every production slice is developed test-first and committed only after its slice checks pass.
See `docs/steward-run-spec.md` for the product boundary.

## Action and workflow contract

The action accepts an exact Task source (`workflow` or `invocation-path`),
workspace-relative input/output paths, and a Steward HTTPS URL. That is the
complete production authentication configuration when Steward and Identity
publish the discovery contract. `id-token: write` is the GitHub Actions input;
a static Steward bearer token is not a customer production credential. The
[customer ARC reusable workflow](.github/workflows/steward-task-customer.yml)
checks out its own action from the exact reusable-workflow repository and
commit reported by GitHub, not from a caller-selected action ref. GitHub.com
callers may consume this public upstream workflow directly at the exact
40-character `workflowCommit` in the signed release manifest. A caller in a
different repository cannot use its job token for the reusable workflow's
internal checkout of a private fork. Release assets therefore ship an official
rendered `steward-task-self-hosted.yml` for private-fork consumers; the caller
vendors that file and GitHub resolves its immutable direct action reference
under the organization's Actions access policy. No PAT or checkout-token input
is added. See the installation guide for the exact flow and the Identity policy
fields that actually exist.
Identity v6 binds numeric owner/repository IDs plus its configured subject,
event, and ref selectors; it does not yet enforce `job_workflow_ref` or the
workflow SHA.

Direct use on a GitHub-hosted runner needs no preinstalled Node 24. The
composite action uses an existing Node 24 runtime when present and otherwise
installs its pinned Node 24 fallback before executing the bundle. The signed
runner image therefore executes its attested runtime without a download:

```yaml
jobs:
  governed:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - id: task
        uses: apelogic-ai/steward-run@REVIEWED_40_HEX_ACTION_COMMIT
        with:
          workflow: CUSTOMER_WORKFLOW_REFERENCE
          inputs: in
          outputs: out
          steward-api-url: https://steward.customer.example
```

The caller checks the invocation manifest into its repository, then uploads `request`; the reusable
job checks out the exact triggered commit for local validation without persisting Git credentials,
downloads the input under `in/`, runs the action, and uploads `out/` as `result`. The action validates that
`invocation-path` is a canonical, non-symlinked regular file but never reads or uploads its bytes.
Its Task create body contains only `contractVersion: steward.task/v2` and that path. Steward fetches
the manifest from the Identity-ratified repository and exact commit.

Direct action use remains available when another workflow owns the artifact steps. All action paths
are relative to `GITHUB_WORKSPACE`. Exactly one Task source is selected: `invocation-path` for the
direct-package v2 flow or `workflow` for the existing versioned Workflow flow. `agent-runtime`
applies only to the latter. Either Task source may also supply `envelope-digest` as an exact
`steward:sha256:<64 lowercase hex>` selector. Steward resolves it only among the caller's active
envelopes. Omitting it remains valid only when that owner has exactly one active envelope.
Reusable workflows expose `job-timeout-minutes` (default 15) and
`runtime-binding-timeout-minutes` (default 10). Both accept whole minutes from
1 through 360; the latter bounds only the controller-binding wait.

When the server-snapshotted diagnostics mode is `full`, successful outputs may include the two
reserved `.steward/diagnostics/*.log` streams. The action validates the reserved paths and 4 MiB
per-stream bounds, emits a sensitive-output warning, disables GitHub workflow-command processing,
and replays stdout and stderr verbatim in separate log groups before finalization. Diagnostics are
never enabled merely because reserved files are present.

## Kubernetes packaging

The installable [`steward-run-arc` application chart](charts/steward-run-arc/)
pins upstream ARC scale-set chart 0.14.2 and creates the runner scale set,
listener, service accounts, and RBAC using its upstream templates. The ARC
dependency archive is vendored and checksum-locked, so chart linting,
rendering, and packaging do not pull a subchart from GHCR. The ARC
controller remains an external shared prerequisite. The chart requires a
customer-owned runner image at a full `sha256` digest and a GitHub registration
URL plus existing App Secret reference. It defaults to zero idle runners and
non-root, no-privilege runner Pods without a Kubernetes API token. The old
[`steward-run` library chart](charts/steward-run/) remains an internal helper,
not the customer installation path. The public runner and chart are published
at the GHCR coordinates above; the [guide](docs/installation.md)
shows how to resolve and verify their immutable digests.
The supported runner artifact is one multi-platform OCI index containing
`linux/amd64` and `linux/arm64`; the chart remains architecture-neutral and
pins the index digest so Kubernetes selects the matching image.
The chart supports GitHub.com organization/repository registration with a
GitHub App only: enterprise-scope URLs and PAT registration are unsupported.
Scale-to-zero, direct container mode, and the single `runner` container name are
deliberate schema constraints, not omitted ARC features.
GitHub requires self-hosted runners to be upgraded within 30 days of a new
runner release. This repository checks Docker base images weekly, but fork and
mirror operators must merge the update, rebuild and publish the image, and
roll out its new digest within that window; pinned images do not self-update.

For a dedicated self-hosted runner that must not pull the ARC job container, use the separately
pinned `steward-task-self-hosted.yml` reusable workflow. It has the same artifact, immutable
Action, output, and `id-token: write` contract, so GitHub emits an exact `job_workflow_ref`; it
does not declare a container. The runner operator is responsible for vetted Bash,
Git, and tar installations and must restrict the runner label to that local environment. The
action uses the image's Node 24 runtime and installs a pinned fallback only
when Node 24 is absent. This is a
separate workflow provenance record, but current Identity v6 cannot select a
workflow ref or SHA; it is not a caller switch on the ARC workflow.

System/process trust is the default for Steward discovery, Identity discovery,
the exchange, and Steward API calls. `identity-exchange-url`,
`identity-exchange-audience`, and `steward-ca-certificate-file` remain optional,
empty-by-default inputs for the explicit compatibility path. Supplying an
exchange URL bypasses discovery; its explicit audience is accepted only with
that URL and is not required yet. Omitting the audience retains the historical
`apelogic-github-identity-exchange` default and emits a value-free deprecation
warning. Supplying a CA file extends the process trust roots for Steward and
Identity. Removal of the default or making the audience required needs a
separately reviewed major-version migration.

The action honors standard upper- and lowercase `HTTP_PROXY`, `HTTPS_PROXY`,
and `NO_PROXY` environment variables for GitHub OIDC, discovery, exchange, and
Steward requests, including the private-CA path. The installation guide lists
the exact operator-configured control-plane destinations and GitHub's required
runner, artifact, registration, and package domains. Proxy credentials are
deployment-owned and must not be committed or placed in chart values.

Discovery and all remote production URLs require HTTPS. Metadata URLs are
derived by the RFC well-known rules, not hostname conventions. The action
rejects credentials, fragments, issuer/resource mismatches, multiple issuers,
redirects, oversized metadata, and bounded-request timeouts. Plaintext HTTP
and direct GitHub-token-to-Steward authentication through `oidc-audience` are
allowed only for loopback tests.

For a standards-based service that projects rotating credentials into the job, set
`bearer-token-file` to the projected file path. The action rereads the file for every request and
accepts only JWTs with `iat` and `exp` whose total lifetime is at most one hour.
Direct OIDC and bearer-file modes are internal/test seams. If neither is set
and no explicit exchange URL is supplied, discovery is selected. Token
contents must never be supplied as action inputs.

Local cross-product harnesses should use that same `bearer-token-file` input with a short-lived,
pre-minted test JWT. This is the supported non-GitHub invocation seam; it does not bypass token
validation or introduce a second Steward client.

The minimal local invocation contract is:

- provide `workflow`, declared workspace-relative `inputs` and `outputs`, the loopback/local
  `steward-api-url`, and `bearer-token-file` through the action inputs (or their corresponding
  `STEWARD_RUN_*` environment variables when executing the bundled entry point);
- point `GITHUB_WORKSPACE` at the harness workspace and provide the ordinary bounded
  `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_JOB`, and `GITHUB_OUTPUT`
  bookkeeping values used for idempotency and results;
- pre-create every declared input path. Steward-run creates only declared output paths recovered
  from the Task archive;
- read successful `outcome`, `status`, `task-uid`, and `runtime-uid` values from
  `GITHUB_OUTPUT`; on failure, read only `outcome`, `failure-category`, optional
  `http-status`, and the versioned bounded annotations/summary described above.

The token file itself is never a result artifact. Harnesses must mount it outside the declared
input/output paths and remove it with the disposable cluster.

`portable-release.yml` publishes the public GHCR image, OCI chart, release
manifest, checksums, verified embedded provenance/SBOM summary, tag-bound signatures, chart
archive, and read-only ARC preflight without cloud-specific infrastructure
inputs. Deployment-specific promotion is deployment-owned and absent from this
repository. Before creating a GitHub release, the workflow stages an exact
asset set and rejects AWS account/role coordinates and deployment-only
hostnames in both text assets and the packaged chart.
