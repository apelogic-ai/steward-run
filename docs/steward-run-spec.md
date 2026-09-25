# steward-run — implementation spec (product repo)

Audience: maintainers and executing coding agents. Repo: `apelogic-ai/steward-run`.
Deliverables: a **composite GitHub Action**, **reusable workflow sources**, a
**runner container image**, and an **installable ARC scale-set adapter chart**.
Layer 2 (a product), and the **reference instance of the product-repo
convention** the other products (`steward`, `mcp-gw`, `observer`, `burble`)
follow.

**Visibility: public OSS.** The repository and source are MIT licensed. It
contains no secrets; operators supply external registration and endpoint
configuration. `main` is branch-protected.

**Purpose.** The thin runner shell + the `steward-run` action — i.e. **the translator** from the
DEV plan §2.1: discover the trusted task issuer → exchange the job's GitHub OIDC token →
call Steward's REST API with the returned short-lived task token → materialise
inputs into the sandbox and collect outputs back via the workspace. It is a product: source +
tests + image + action, released **by version**, and **environment-agnostic**.

---

## 1. Scope

**In scope.**
- The **`steward-run` composite action** (`action.yml` + its scripts).
- The **runner image** (Dockerfile): `actions/runner` base + the action's prerequisites. Minimal,
  no baked secrets. Steward's immutable Workflow selects runtime configuration and skills.
- App CI: build + test. The portable release publishes the image and
  installable chart to public GHCR OCI; a separate workflow retains the
  ApeLogic-internal ECR evidence handoff.
- The **thin-shell CI check** (§4) as a first-class test.

**Out of scope.**
- The operator's org, cluster, namespace, registration credential values,
  endpoint values, and production capacity choices. The chart exposes these
  inputs without owning them.
- Cloud resources — **`infra`**.
- Any secret value. The action receives config via inputs/env at runtime; it holds nothing.
- The Steward control-plane itself, and the `Principal::Service` arm it depends on — that's the
  `steward` repo (a hard dependency, §7).

---

## 2. The layer-2 product-repo convention (stated here; all products follow it)

1. **Chart/image/action live in-repo; the product owns how it is built.**
2. **CI publishes by version**: runner images and deployable charts are OCI
   artifacts. The public release uses GHCR; forks may publish to their own
   registries; ApeLogic's internal handoff remains separate.
3. **The product never hard-codes a customer environment.** Example names and
   URLs are placeholders; the operator selects cluster, namespace, endpoints,
   runner labels, and capacity in its values and caller workflow.
4. **Consumers pin immutable artifacts.** Images use an OCI digest, charts use
   a reviewed package/version plus digest evidence, and workflows use an exact
   source commit.
5. **No secret values.** Runtime configuration uses action inputs, environment
   data, and references to operator-created Secrets; the chart never renders a
   registration key or registry credential.
6. **Version pins are explicit** (base image, agent runtime, dependencies); nothing floats.

---

## 3. What the action does (the two responsibilities, from plan §2.1)

The action runs inside the ARC runner job and does exactly two categories of thing:

1. **GitHub-token-bound work** (only possible inside a live job): read/`download-artifact` the
   declared `inputs` from `$GITHUB_WORKSPACE`; at the end, write `outputs` back for a following
   `upload-artifact` step; obtain the job's OIDC id-token (`ACTIONS_ID_TOKEN_REQUEST_URL` +
   `ACTIONS_ID_TOKEN_REQUEST_TOKEN`; the workflow must grant `id-token: write`).
2. **Call Steward's REST API** as the translator: exchange the GitHub OIDC token server-side for a
   short-lived `steward-task-api` token, then submit a Steward `Task`. The exchange validates the
   calling workflow and resolves the actor. For direct packages, the action submits only the v2
   contract selector and a locally validated invocation path; Steward fetches that path from the
   Identity-ratified repository and exact trigger commit. The action never submits manifest or
   package bytes. Steward resolves the approved Envelope and returns the durable Task identity.
   For controller-owned creation, that first accepted response
   has `runtimeUid: null`; the action polls that exact Task until the controller binds the immutable
   runtime UID, and only then exposes `runtime-uid`, uploads inputs, or requests execution. The action
   polls Task status through any approval hold, collects
   outputs after success, and requests finalization. A provisioned runtime is terminated; an
   adopted runtime is detached (see D2). If cancellation happens before binding, Steward keeps
   `runtimeUid: null` while the cancelled Task reaches `finalized: true`; the action confirms that
   cleanup without inventing or publishing a runtime UID.

The controller-binding wait is bounded by both 60 attempts and a ten-minute wall-clock deadline.
Cancellation and that deadline propagate through binding sleeps, token acquisition, and the
in-flight Task-status request; a stalled credential provider or HTTP fetch cannot extend the wait.

Direct-package flow: exact trigger checkout for local validation without persisted credentials →
`download-artifact` (regular step) → `steward-run` (materialise in → API provision → run
→ collect out) → `upload-artifact` (regular step). The agentic step is invisible to the
surrounding YAML; the workspace is the contract.

The customer reusable workflow runs directly in the digest-pinned ARC runner
image and pins its own action checkout to the reusable workflow's exact
repository and commit. It does not accept a caller-selected executable image
or action ref. The legacy ApeLogic workflow separately supplies a digest-pinned
ECR job container and is not the customer installation path. Either execution
container must provide Bash, Node, Git, and tar for JavaScript actions and the
composite action.

---

## 4. The thin-shell discipline (a CI check, not a principle)

The image and the action carry **no tool credential, no LLM key, no data-plane egress
allowance**; the only Steward-facing capability is the REST API. `GITHUB_TOKEN` is **never**
passed to the agent (the sandbox does its own git via the gateway); the artifact runtime token
stays in the runner. A test asserts these — a violation fails the build. This is what keeps the
move to a trigger-only topology (plan Option A) a small change rather than a rewrite.

**Park/resume token rule.** Artifact publish needs the run-scoped token, which dies with the
job. If a walk parks, the collect-and-upload happens within a live job — before release, or on
the resumed invocation (a new job, new token).

---

## 5. The action contract (`action.yml`)

| Input | Meaning |
|---|---|
| `invocation-path` | Canonical repository-relative v2 invocation-manifest path; its bytes are never submitted |
| `workflow` | Existing immutable Steward Workflow reference forwarded unchanged (e.g. `repository-review@1`) |
| `inputs` | Workspace path(s) materialised into the sandbox as its input directory |
| `outputs` | Sandbox output path(s) written back to the workspace |
| `steward-api-url` | The control-plane API base (env-supplied; not hardcoded) |
| `steward-ca-certificate-file` *(deprecated compatibility, default `""`)* | Filesystem path to a public PEM CA bundle extending process trust for Steward and Identity |
| `identity-exchange-url` *(deprecated compatibility, default `""`)* | Explicit HTTPS exchange endpoint; when absent, discover from Steward |
| `identity-exchange-audience` *(deprecated compatibility, default `""`)* | Exact GitHub OIDC audience for the explicit exchange URL only |
| `oidc-audience` *(test authentication choice)* | Direct GitHub OIDC audience; allowed only with a loopback Steward API |
| `bearer-token-file` *(authentication choice)* | Filesystem path to a rotating JWT with a maximum one-hour lifetime |
| `agent-runtime` *(optional)* | Adopt an existing `AgentRuntime` id for the existing Workflow path only (D2) |

Exactly one of `invocation-path` and `workflow` is required. The v2 reusable-workflow path uses
`invocation-path`; the legacy input remains additive compatibility for direct action and existing
callers. The runner verifies that a direct invocation path is canonical, exists at the clean exact
trigger checkout, contains no symlink component, and names a regular file. This is an early local
failure only: Steward's authenticated exact-commit source retrieval is authoritative.

With no explicit authentication choice, production uses discovery. The action
derives `/.well-known/oauth-protected-resource` from the exact Steward resource,
requires that document to identify the same resource and exactly one issuer,
then derives `/.well-known/oauth-authorization-server` from that issuer. The
Identity document must repeat the exact issuer and provide `token_endpoint`.
The GitHub audience is its non-empty, bounded `github_oidc_audience`, or the
exact issuer URL when the field is absent. The action never derives an exchange
endpoint from a hostname convention.

Discovery allows no redirects, caps each JSON document at 64 KiB, permits at
most two metadata requests, limits each request to five seconds and the total
to ten seconds, and caches only a successful result for the action process.
Every URL is bounded to 2,048 characters, rejects credentials/fragments, and
requires HTTPS except for loopback tests. The returned token must retain the
existing sole `steward-task-api` audience and lifetime checks.

An explicit `identity-exchange-url` takes precedence and bypasses discovery;
`identity-exchange-audience` is rejected without it. A CA is supplied only as
a file path, never inline PEM, and extends rather than replaces system trust.
An explicit URL with an empty audience retains the historical
`apelogic-github-identity-exchange` audience.
All three compatibility inputs are optional with empty defaults and emit
sanitized deprecation notices when used. They cannot be removed without a
separately reviewed major-version contract and migration. `oidc-audience` and
`bearer-token-file` remain test/internal modes and are not public reusable-
workflow inputs. Tokens are never action inputs.

| Output | Meaning |
|---|---|
| `status` | Terminal phase of the Task |
| `task-uid` | The Steward Task UID (for audit correlation) |
| `runtime-uid` | The provisioned/adopted `AgentRuntime` UID (for audit correlation) |

On failure, the action writes one GitHub error annotation and one step-summary entry using the
versioned `steward-run.failure/v1` diagnostic contract. It contains exactly:

- terminal phase: `succeeded`, `failed`, `cancelled`, or `unavailable`;
- a bounded failure category;
- an independent finalization category.

The failure allowlist is `provider-connection`, `provider-token-grant`, `provider-grant`,
`provider-protocol`,
`provider-authorization`, `provider-upstream`, `assertion-mismatch`, `workflow-cleanup`,
`authentication`, `authorization`, `validation`, `conflict`, `configuration`, `dependency`,
`transport`, `malformed-response`, `input-output`, `runtime`, `timeout`, `execution`, `cancelled`,
and `unknown`. Exact agent exit codes 70 through 75 map to
`provider-connection`, `provider-token-grant`, `provider-authorization`, `provider-upstream`,
`assertion-mismatch`, and `workflow-cleanup`, respectively. Exact agent exit 76 maps to
`provider-grant`; exact agent exit 77 maps to `provider-protocol`. Except for the staged assertion
exits described below, every other numeric agent exit maps to `execution`. `provider-protocol` is
limited to a local MCP framing, JSON-RPC, or session-contract failure after provider
authentication; response data never becomes metadata.
Finalization categories are `confirmed`, `not-required`, `request-failed`,
`confirmation-timeout`, `identity-mismatch`, and `unknown`.

Exact agent exits 78 through 81 are the sole exception to the generic numeric-exit rule. They all
retain `assertion-mismatch` and add one independently versioned, allowlisted
`steward-run.assertion-stage/v1` signal: 78 is `input-request`, 79 is `runtime-toolchain`, 80 is
`model-result`, and 81 is `mcp-tool-event`. The original `steward-run.failure/v1` annotation and
summary row remain byte-for-byte compatible; a staged assertion adds a second bounded annotation
and a second summary table. Legacy exact exit 74 remains `assertion-mismatch` with no stage.
Malformed or decorated reasons, unknown codes, and runtime-supplied text cannot select a stage.

A Steward HTTP/request failure adds a separately versioned
`steward-run.request-failure/v1` annotation and summary row while retaining the original v1
failure record. The request signal contains only an allowlisted stage, its bounded category, an
optional integer HTTP status, and an optional correlation identifier accepted only from
`X-Correlation-ID` or `X-Request-ID` after strict length and character validation. Validation
(400/422), authentication (401), authorization (403), conflict (409), dependency (including 503),
timeout, transport, and malformed-response remain distinct. Response bodies and arbitrary headers
are never parsed into diagnostics.

Only those literals are rendered on failure. Arbitrary failure reasons, command output, HTTP bodies
or headers, JWTs, assertions, provider tokens, API keys, cookies, credentials, and Kubernetes Secret
values are neither rendered nor persisted by failure reporting. A finalization failure never
replaces the primary failure category. Successful runs retain their existing outputs and publish no
failure metadata.

If and only if the authenticated v2 Task status reports snapshotted
`diagnostics.executionLog: full`, the successful output archive must carry exact server-owned
stdout and stderr entries beneath `.steward/diagnostics`. Each is limited to 4 MiB. After archive
validation, the action emits a sensitive-output warning, disables GitHub workflow-command
interpretation with an unpredictable per-run command token, replays the original streams in
separate groups, restores command processing, and then finalizes. Missing, extra, malformed, or
over-limit diagnostic entries fail the action and still finalize the Task.

`action.yml` is `runs: composite`. No `<form>`-style ambient config; everything is an input or
env. Verify current GitHub Actions OIDC + artifact APIs when implementing.

---

## 6. The runner image

- Base: pinned `actions/runner`.
- Plus the `steward-run` prerequisites; agent runtime configuration and skills belong to the
  immutable Steward Workflow and are not caller inputs or image contents.
- **No secrets, minimal packages** (the modern runner image ships lean on purpose; add only what
  the agent needs). Multi-stage build; pinned digests.
- Published publicly to GHCR as a multi-platform OCI index by version. A fork
  may publish the same source to a customer-owned registry. Environment config
  pins the ARC runner by digest; the legacy internal governed workflow
  independently pins its ECR job-container image by digest.

---

## 7. Dependencies & seams

- **Hard dependency: Steward's Task API and identity exchange boundary.** The
  six-operation Task lifecycle and service groups are implemented. Customer
  callers use `.github/workflows/steward-task-customer.yml` from a reviewed
  fork commit so GitHub emits an allowlistable `job_workflow_ref`; the workflow
  checks out its action from that same exact repository and commit. The
  exchange emits a short-lived `steward-task-api` token. ApeLogic's internal
  workflow retains its separate signed-manifest pins.
- **Consumed by ARC/operator configuration** (the scale set pins the image)
  and **by customer workflows** (the reusable workflow is pinned to an exact
  fork commit). ApeLogic GitOps and workflows are separate internal consumers.
- **Verified contract:** `contracts/steward-run-v1.openapi.yaml` records Steward's `/v1/tasks`
  submission, input, execute, status, output, and finalization operations. Workspace-relative
  input and output tar archives are limited to 64 MiB each.

---

## 8. Acceptance criteria (falsifiable)

1. `action.yml` used in a test workflow provisions an `AgentRuntime` via a test Steward API and
   reaches a terminal `status`.
2. A **governed tool call executes as the resolved user** (through `mcp-gw`), and inference runs
   on the per-runtime LiteLLM key — the agent holding neither credential.
3. **Composability:** a pipeline `download-artifact` → `steward-run` → `upload-artifact`
   round-trips a file with no workflow-author awareness of the sandbox.
4. **Thin-shell check passes:** no tool cred, no LLM key, no data-plane egress, REST API the
   only Steward capability; `GITHUB_TOKEN` never reaches the agent.
5. The image builds, passes the check, and the standalone release publishes
   the multi-platform image and application chart to public GHCR OCI by
   version. A fork can publish equivalent artifacts to its own registry.
6. `gitleaks` is green; no secret in history.

---

## 9. Open decisions

| # | Decision | Recommendation | Cost of deferring |
|---|---|---|---|
| D1 | Repo name | `steward-run` (matches the `uses:` line). `arc-runner` if a Steward-agnostic name is wanted | Low |
| D2 | Provision-per-job vs adopt a standing `AgentRuntime` | Resolved: provision and terminate by default; explicit `agent-runtime` adopts and detaches an existing runtime | — |
| D3 | Coding-agent runtime | Resolved by Steward from the immutable Workflow reference | — |
| D4 | Visibility | Resolved: public MIT-licensed OSS | — |
| D5 | `containerMode` coupling | Resolved for the customer chart: run directly in the hardened runner container with `containerMode.type: ""`; alternate modes require separate operator validation | — |

---

## 10. Agent execution notes

- Keep GitHub Actions OIDC and artifact usage aligned with their current APIs, and keep the
  checked-in Task contract aligned with Steward's generated OpenAPI before each release.
- **Pin** the base runner image, the agent runtime, and every dependency by digest/version.
- **The thin-shell check is a build gate**, not documentation.
- **Stop at the boundary (§1).** Do not hard-code customer environment names,
  endpoints, credential values, or private registry coordinates. Expose
  operator-owned configuration through the documented values and workflow
  interfaces.
