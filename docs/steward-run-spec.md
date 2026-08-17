# steward-run — implementation spec (product repo)

Audience: an executing coding agent. Repo: `apelogic-ai/steward-run`. Deliverables: a **composite
GitHub Action** + a **runner container image**. Layer 2 (a product), and the **reference
instance of the product-repo convention** the other products (`steward`, `mcp-gw`, `observer`,
`burble`) follow.

**Visibility: internal (recommended) — not public by default.** It contains no secrets, but it
encodes the ARC↔Steward integration contract and the control-plane API shape. Internal
(org-readable) unless the API contract is deemed sensitive, in which case private. Decide in D4.
`main` branch-protected.

**Purpose.** The thin runner shell + the `steward-run` action — i.e. **the translator** from the
DEV plan §2.1: validate the job's GitHub OIDC token → resolve the actor to a corporate email →
call Steward's REST API as a *service principal acting-for the resolved user* → materialise
inputs into the sandbox and collect outputs back via the workspace. It is a product: source +
tests + image + action, released **by version**, and **environment-agnostic**.

---

## 1. Scope

**In scope.**
- The **`steward-run` composite action** (`action.yml` + its scripts).
- The **runner image** (Dockerfile): `actions/runner` base + the coding-agent runtime
  (pluggable) + base skills + the action's prerequisites. Minimal, no baked secrets.
- App CI: build + test → push image to ECR (OCI) → tag/release by version.
- The **thin-shell CI check** (§4) as a first-class test.

**Out of scope.**
- Which org/cluster/namespace/env it runs in, `runs-on` labels, replica counts, the GitHub App
  secret — all **`gitops`** (scale-set `HelmRelease`).
- Cloud resources — **`infra`**.
- Any secret value. The action receives config via inputs/env at runtime; it holds nothing.
- The Steward control-plane itself, and the `Principal::Service` arm it depends on — that's the
  `steward` repo (a hard dependency, §7).

---

## 2. The layer-2 product-repo convention (stated here; all products follow it)

1. **Chart/image/action live in-repo; the product owns how it is built.**
2. **CI publishes by version**: image → ECR OCI; chart (for a deployable product) → ECR OCI
   chart repo. The released version is the deliverable.
3. **The product never names an environment.** No cluster, namespace, values, or `runs-on`
   label appears in the repo. If it would differ between DEV and prod, it is `gitops`' job.
4. **`gitops` pins the version.** Promotion is a one-line PR there, not a change here.
5. **No secret values.** Config arrives at runtime (action inputs, env, mounted secrets created
   by ESO).
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
   calling workflow and resolves the actor. Steward selects the versioned workflow envelope,
   provisions or adopts its `AgentRuntime`, and returns the durable Task identity. The action
   uploads inputs, requests execution, polls Task status through any approval hold, collects
   outputs after success, and requests finalization. A provisioned runtime is terminated; an
   adopted runtime is detached (see D2).

Flow: `download-artifact` (regular step) → `steward-run` (materialise in → API provision → run
→ collect out) → `upload-artifact` (regular step). The agentic step is invisible to the
surrounding YAML; the workspace is the contract.

The reusable workflow supplies a job-level container for Kubernetes-mode ARC. Its ECR image is a
literal full digest in the workflow, cannot be selected by the caller, and relies on node-level
pull authorization rather than workflow credentials. The container must provide Bash, Node, Git,
and tar so JavaScript actions and the composite action run inside the enforced job container.

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
| `workflow` | Which agentic workflow / agent-type + envelope to run (e.g. `cve-triage`) |
| `inputs` | Workspace path(s) materialised into the sandbox as its input directory |
| `outputs` | Sandbox output path(s) written back to the workspace |
| `steward-api-url` | The control-plane API base (env-supplied; not hardcoded) |
| `steward-ca-certificate-file` *(optional)* | Filesystem path to the PEM CA bundle trusted for Steward TLS |
| `identity-exchange-url` *(authentication choice)* | HTTPS endpoint that exchanges GitHub OIDC for a short-lived Steward token |
| `oidc-audience` *(test authentication choice)* | Direct GitHub OIDC audience; allowed only with a loopback Steward API |
| `bearer-token-file` *(authentication choice)* | Filesystem path to a rotating JWT with a maximum one-hour lifetime |
| `agent-runtime` *(optional)* | Adopt an existing `AgentRuntime` id instead of provisioning (D2) |

Exactly one authentication choice is required. Tokens are never action inputs. A CA is supplied as
a file path rather than inline PEM, and custom trust is scoped to Steward requests. Remote API URLs
must use HTTPS; missing/invalid CA files, untrusted chains, and hostname mismatch fail closed. The
exchange always requests GitHub audience `apelogic-github-identity-exchange` and accepts only an
exchanged token with sole audience `steward-task-api`.

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
`authentication`, `authorization`, `configuration`, `dependency`, `input-output`, `runtime`,
`timeout`, `execution`, `cancelled`, and `unknown`. Exact agent exit codes 70 through 75 map to
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
`model-result`, 81 is `mcp-tool-event`, and 88 is `mcp-no-call`. The original `steward-run.failure/v1` annotation and
summary row remain byte-for-byte compatible; a staged assertion adds a second bounded annotation
and a second summary table. Legacy exact exit 74 remains `assertion-mismatch` with no stage.
Malformed or decorated reasons, unknown codes, and runtime-supplied text cannot select a stage.

Only those literals are rendered. Arbitrary failure reasons and command output, HTTP bodies or
headers, JWTs, assertions, provider tokens, API keys, cookies, credentials, and Kubernetes Secret
values are neither rendered nor persisted. A finalization failure never replaces the primary
failure category. Successful runs retain their existing outputs and publish no failure metadata.

`action.yml` is `runs: composite`. No `<form>`-style ambient config; everything is an input or
env. Verify current GitHub Actions OIDC + artifact APIs when implementing.

---

## 6. The runner image

- Base: pinned `actions/runner`.
- Plus: the coding-agent runtime (pluggable — Claude Code to start; the runtime is an input, not
  a weld), base skills, and the `steward-run` prerequisites.
- **No secrets, minimal packages** (the modern runner image ships lean on purpose; add only what
  the agent needs). Multi-stage build; pinned digests.
- Published to ECR OCI by version. `gitops` pins the ARC runner by digest; the governed workflow
  independently pins its job-container image by digest.

---

## 7. Dependencies & seams

- **Hard dependency: Steward's Task API and identity exchange boundary.** The six-operation Task
  lifecycle and service groups are implemented. Production callers use the reusable
  `.github/workflows/steward-task.yml` workflow so GitHub emits an allowlistable
  `job_workflow_ref`. The call is pinned to `workflow_commit` from the signed release manifest;
  that workflow pins the remote action to the distinct `action_commit`, and the exchange emits a
  short-lived `steward-task-api` token.
- **Consumed by `gitops`** (scale set pins the image) and **by workflows** (the reusable workflow
  internally uses `apelogic-ai/steward-run@<action_commit>`).
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
5. The image builds, passes the check, and publishes to ECR OCI by version.
6. `gitleaks` is green; no secret in history.

---

## 9. Open decisions

| # | Decision | Recommendation | Cost of deferring |
|---|---|---|---|
| D1 | Repo name | `steward-run` (matches the `uses:` line). `arc-runner` if a Steward-agnostic name is wanted | Low |
| D2 | Provision-per-job vs adopt a standing `AgentRuntime` | Resolved: provision and terminate by default; explicit `agent-runtime` adopts and detaches an existing runtime | — |
| D3 | Coding-agent runtime | Pluggable via input; Claude Code first. Do not weld it into the image | Low |
| D4 | Visibility | Internal by default; private if the API contract is sensitive | Low |
| D5 | `containerMode` coupling | The action must work under both `kubernetes` and `dind`; the choice is `gitops`', not baked here | Low |

---

## 10. Agent execution notes

- Keep GitHub Actions OIDC and artifact usage aligned with their current APIs, and keep the
  checked-in Task contract aligned with Steward's generated OpenAPI before each release.
- **Pin** the base runner image, the agent runtime, and every dependency by digest/version.
- **The thin-shell check is a build gate**, not documentation.
- **Stop at the boundary (§1).** No env names, no `runs-on` labels, no secrets — those are
  `gitops`. If you reach for one, you are in the wrong repo.
