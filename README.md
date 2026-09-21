# steward-run

`steward-run` is the environment-agnostic GitHub Action and ARC runner image that translates a
live GitHub Actions job into a governed Steward Task. The workspace is the only workflow
author-facing data contract.

Start with the [versioned installation guide](docs/installation-v0.4.0.md).
The product is [MIT licensed](LICENSE): this repository owns the runner image,
composite action, reusable workflow sources, and installable
[`steward-run-arc` chart](charts/steward-run-arc/). The ARC controller and GitHub
runner registration API are external prerequisites; this is not a separate
long-running Steward API service. No public runner image or chart coordinate
has yet been published by this repository. The guide documents a fork-owned
build and installation, and explicitly marks the live acceptance still pending.

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

When a Steward API request itself fails, the existing failure contract is accompanied by
`steward-run.request-failure/v1`. That bounded signal identifies the request stage and category,
plus the numeric HTTP status and a syntactically constrained `X-Correlation-ID` or `X-Request-ID`
when the response supplies them. Submit failures distinguish validation (400/422), authentication
(401), authorization (403), conflict (409), dependency failures (including 503), timeout,
transport, and malformed successful responses. Failure response bodies and all other headers are
ignored.

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

For the existing ApeLogic workflow, production authentication exchanges a
GitHub OIDC token with audience `apelogic-github-identity-exchange` for a
short-lived token whose sole audience is `steward-task-api`. Customer
installations must configure their own exact audience and exchange endpoint.
The exchange validates the caller and resolves the actor before Steward sees
the credential. The mock round trip proves token routing but does not prove a
deployed exchange, Steward control plane, or real Agent Sandbox.

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
workspace-relative input/output paths, a Steward HTTPS URL, and a GitHub OIDC
exchange HTTPS URL with its exact audience. `id-token: write` is the GitHub
Actions input; a static Steward bearer token is not a customer production
credential. The [customer ARC reusable workflow](.github/workflows/steward-task-customer.yml)
checks out its own action from the exact reusable-workflow repository and
commit reported by GitHub, not from a caller-selected action ref. The existing
ApeLogic-pinned reusable workflows are not the fork installation path. See
the installation guide for the exact caller pin and pending live acceptance.

The caller checks the invocation manifest into its repository, then uploads `request`; the reusable
job checks out the exact triggered commit for local validation without persisting Git credentials,
downloads the input under `in/`, runs the action, and uploads `out/` as `result`. The action validates that
`invocation-path` is a canonical, non-symlinked regular file but never reads or uploads its bytes.
Its Task create body contains only `contractVersion: steward.task/v2` and that path. Steward fetches
the manifest from the Identity-ratified repository and exact commit.

Direct action use remains available when another workflow owns the artifact steps. All action paths
are relative to `GITHUB_WORKSPACE`. Exactly one Task source is selected: `invocation-path` for the
direct-package v2 flow or `workflow` for the existing versioned Workflow flow. `agent-runtime`
applies only to the latter.

When the server-snapshotted diagnostics mode is `full`, successful outputs may include the two
reserved `.steward/diagnostics/*.log` streams. The action validates the reserved paths and 4 MiB
per-stream bounds, emits a sensitive-output warning, disables GitHub workflow-command processing,
and replays stdout and stderr verbatim in separate log groups before finalization. Diagnostics are
never enabled merely because reserved files are present.

## Kubernetes packaging

The installable [`steward-run-arc` application chart](charts/steward-run-arc/)
pins upstream ARC scale-set chart 0.14.2 and creates the runner scale set,
listener, service accounts, and RBAC using its upstream templates. The ARC
controller remains an external shared prerequisite. The chart requires a
customer-owned runner image at a full `sha256` digest and a GitHub registration
URL plus existing App Secret reference. It defaults to zero idle runners and
non-root, no-privilege runner Pods without a Kubernetes API token. The old
[`steward-run` library chart](charts/steward-run/) remains an internal helper,
not the customer installation path. No image or chart OCI coordinate is
published by this repository yet; the [guide](docs/installation-v0.4.0.md)
shows how a fork publishes its own artifacts.

For a dedicated self-hosted runner that must not pull the ARC job container, use the separately
pinned `steward-task-self-hosted.yml` reusable workflow. It has the same artifact, immutable
Action, output, and `id-token: write` contract, so GitHub emits an exact `job_workflow_ref`; it
does not declare a container. The runner operator is responsible for a vetted Node 24, Bash,
Git, and tar installation and must restrict the runner label to that local environment. This is a
separate workflow identity and must be authorized explicitly by the identity policy; it is not a
caller switch on the ARC workflow.

`steward-ca-certificate-file` is an optional filesystem path to a PEM CA bundle used only for
Steward API TLS. Missing or malformed files, an untrusted chain, and hostname mismatch fail closed.
Remote Steward URLs must use HTTPS; plaintext HTTP is accepted only for loopback tests.

For production direct-action use, set `identity-exchange-url`; the action requests and exchanges a
fresh GitHub OIDC token for every Steward request. The exchange and Steward URLs require HTTPS.
Plaintext is accepted only for loopback tests, and direct GitHub-token-to-Steward authentication
through `oidc-audience` is also loopback-only.

For a standards-based service that projects rotating credentials into the job, set
`bearer-token-file` to the projected file path. The action rereads the file for every request and
accepts only JWTs with `iat` and `exp` whose total lifetime is at most one hour. Exactly one of
`identity-exchange-url`, `oidc-audience`, and `bearer-token-file` is required. Token contents must
never be supplied as action inputs.

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
- read successful `status`, `task-uid`, and `runtime-uid` values from `GITHUB_OUTPUT`; on failure,
  read only the versioned bounded annotations/summary described above.

The token file itself is never a result artifact. Harnesses must mount it outside the declared
input/output paths and remove it with the disposable cluster.

The current `release.yml` is an ApeLogic-internal ECR handoff, not the fork
publication procedure. The versioned installation guide gives the portable
image and chart build/publish commands and the evidence to retain. The
customer workflow and live end-to-end acceptance remain open in issue #41;
neither this README nor a passing chart render claims otherwise.
