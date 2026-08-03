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
2. **Call Steward's REST API** as the translator: validate the OIDC token, resolve the actor to
   a **corporate email server-side** (R6 / roadmap §2.6.5), then `POST` to provision/adopt an
   `AgentRuntime` (principal = `Service` acting-for the resolved user; `agentType`/`tools`/
   `llms`/`budget` = the selected workflow's envelope), poll `status.phase`, and on completion
   collect the sandbox's outputs into the workspace. Provision-run-**terminate** per job by
   default (see D2).

Flow: `download-artifact` (regular step) → `steward-run` (materialise in → API provision → run
→ collect out) → `upload-artifact` (regular step). The agentic step is invisible to the
surrounding YAML; the workspace is the contract.

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
| `agent-runtime` *(optional)* | Adopt an existing `AgentRuntime` id instead of provisioning (D2) |

| Output | Meaning |
|---|---|
| `status` | Terminal phase of the walk |
| `runtime-uid` | The provisioned/adopted `AgentRuntime` UID (for audit correlation) |

`action.yml` is `runs: composite`. No `<form>`-style ambient config; everything is an input or
env. Verify current GitHub Actions OIDC + artifact APIs when implementing.

---

## 6. The runner image

- Base: pinned `actions/runner`.
- Plus: the coding-agent runtime (pluggable — Claude Code to start; the runtime is an input, not
  a weld), base skills, and the `steward-run` prerequisites.
- **No secrets, minimal packages** (the modern runner image ships lean on purpose; add only what
  the agent needs). Multi-stage build; pinned digests.
- Published to ECR OCI by version. `gitops`' scale set pins this tag.

---

## 7. Dependencies & seams

- **Hard dependency: `steward`'s `Principal::Service` arm** (roadmap §4; DEV plan Phase C). The
  acting-for-a-user API call cannot succeed until the mint/admission/mcp-gw service arm is
  finished. Do not ship the action's provision path against a Steward that still rejects
  `Service`.
- **Consumed by `gitops`** (scale set pins the image) and **by workflows** (`uses:
  apelogic-ai/steward-run@vX`).
- **Unverified contract:** the exact Steward apiserver route the action calls (provision/adopt
  `AgentRuntime`, poll status) was **not** inspected in `steward-apiserver`. Confirm it against
  the live API before building §3 — it is the roadmap's model, not a read fact.

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
| D2 | Provision-per-job vs adopt a standing `AgentRuntime` | Provision-run-terminate per job for v0 (pure Plane A, no Task). Adopt-standing is cheaper per job but raises "who owns the standing runtime's lifecycle" | Medium — decide before the action's provision path is written |
| D3 | Coding-agent runtime | Pluggable via input; Claude Code first. Do not weld it into the image | Low |
| D4 | Visibility | Internal by default; private if the API contract is sensitive | Low |
| D5 | `containerMode` coupling | The action must work under both `kubernetes` and `dind`; the choice is `gitops`', not baked here | Low |

---

## 10. Agent execution notes

- **Verify current GitHub Actions OIDC and artifact APIs** and the Steward apiserver route
  contract (§7) before writing §3 — do not build against the roadmap's model as if it were the
  live API.
- **Pin** the base runner image, the agent runtime, and every dependency by digest/version.
- **The thin-shell check is a build gate**, not documentation.
- **Stop at the boundary (§1).** No env names, no `runs-on` labels, no secrets — those are
  `gitops`. If you reach for one, you are in the wrong repo.
