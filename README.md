# steward-run

`steward-run` is the environment-agnostic GitHub Action and ARC runner image that translates a
live GitHub Actions job into a governed Steward Task. The workspace is the only workflow
author-facing data contract.

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

Governed smoke workflows may use the exact agent exit codes 70–75 for
`provider-connection`, `provider-token-grant`, `provider-authorization`, `provider-upstream`,
`assertion-mismatch`, and `workflow-cleanup`, respectively. Exact agent exit 76 maps to
`provider-grant`, which identifies an absent or incomplete local provider OAuth grant before a
provider-backed request. Any other numeric agent exit maps to `execution`. Steward finalization is
reported separately as `confirmed`, `not-required`,
`request-failed`, `confirmation-timeout`, `identity-mismatch`, or `unknown`.

Production authentication exchanges a GitHub OIDC token with audience
`apelogic-github-identity-exchange` for a short-lived token whose sole audience is
`steward-task-api`. The exchange validates the caller and resolves the actor before Steward sees
the credential. The mock round trip proves token routing but does not prove a deployed exchange,
Steward control plane, or real Agent Sandbox.

## Development

Requires Node.js 24 and Docker.

```console
npm ci
npm run check
```

Every production slice is developed test-first and committed only after its slice checks pass.
See `docs/steward-run-spec.md` for the product boundary.

## Usage

The reusable workflow requires `id-token: write` and transfers caller inputs and returned outputs
as artifacts. Pin the workflow call to `workflow_commit` from the signed release manifest. The
workflow itself pins the remote action to the distinct immutable `action_commit`; callers cannot
override it. GitHub emits the workflow SHA as `job_workflow_ref`.

```yaml
jobs:
  governed:
    permissions:
      contents: read
      id-token: write
    uses: apelogic-ai/steward-run/.github/workflows/steward-task.yml@<WORKFLOW_COMMIT>
    with:
      runner-label: ${{ vars.STEWARD_RUNNER_LABEL }}
      workflow: cve-triage
      input-artifact: request
      output-artifact: result
      steward-api-url: ${{ vars.STEWARD_API_URL }}
      identity-exchange-url: ${{ vars.IDENTITY_EXCHANGE_URL }}
      steward-ca-certificate-file: ${{ vars.STEWARD_CA_CERTIFICATE_FILE }}
```

The caller first uploads `request`; the reusable job downloads it under `in/`, runs the action,
and uploads `out/` as `result`. Direct action use remains available when another workflow owns the
artifact steps. All action paths are relative to `GITHUB_WORKSPACE`.

The governed job always runs inside the signed v0.3.0 `steward-run` image pinned by its full ECR
digest in `steward-task.yml`. The image is not a workflow input and the workflow supplies no
registry credential; Kubernetes-mode ARC nodes use their scoped ECR pull access. The container
provides Bash, Node, Git, and tar for artifact and composite-action steps.

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

Dispatching the release workflow with version `X.Y.Z` builds `linux/amd64` under a unique candidate
tag and attaches provenance and an SBOM. The workflow keylessly signs the OCI index using OCI 1.1,
verifies both the local bundle and registry referrer, and signs a manifest that distinguishes the
reusable `workflow_commit`, remote `action_commit`, ARC runner image digest, and governed job-container image
digest. Only then does it create the final `X.Y.Z` image tag and `vX.Y.Z` GitHub release, with the
manifest and Sigstore bundles attached for GitOps consumption. `AWS_REGION`,
`AWS_ROLE_ARN`, `ECR_REGISTRY`, and `ECR_REPOSITORY` are repository variables; release
authentication uses GitHub OIDC.
