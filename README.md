# steward-run

`steward-run` is the environment-agnostic GitHub Action and ARC runner image that translates a
live GitHub Actions job into a governed Steward Task. The workspace is the only workflow
author-facing data contract.

The client implements Steward's six-operation `/v1/tasks` lifecycle documented in
`contracts/steward-run-v1.openapi.yaml`. It submits, uploads a workspace-relative tar archive,
requests execution, polls through approval parking to a terminal phase, downloads declared
outputs, and always requests finalization.

Production activation still requires an identity mapper in front of Steward. It must validate
GitHub OIDC claims, authorize the invoking repository and workflow, resolve the actor, and produce
the `steward-run` service and acting-user groups accepted by Steward's TokenReview boundary. The
required token audience is `steward-task-api`; the mock round trip does not prove that production
identity path or a real Agent Sandbox.

## Development

Requires Node.js 24 and Docker.

```console
npm ci
npm run check
```

Every production slice is developed test-first and committed only after its slice checks pass.
See `docs/steward-run-spec.md` for the product boundary.

## Usage

GitHub OIDC mode requires `id-token: write`; artifact download and upload remain ordinary adjacent
steps. All paths are relative to `GITHUB_WORKSPACE`.

```yaml
- uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0
  with:
    name: request
    path: in
- uses: apelogic-ai/steward-run@v0.2.3
  with:
    workflow: cve-triage
    inputs: in
    outputs: results
    steward-api-url: ${{ vars.STEWARD_API_URL }}
    oidc-audience: steward-task-api
    steward-ca-certificate-file: ${{ vars.STEWARD_CA_CERTIFICATE_FILE }}
- uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
  with:
    name: result
    path: results
```

`steward-ca-certificate-file` is an optional filesystem path to a PEM CA bundle used only for
Steward API TLS. Missing or malformed files, an untrusted chain, and hostname mismatch fail closed.
Remote Steward URLs must use HTTPS; plaintext HTTP is accepted only for loopback tests.

For an identity service that projects rotating credentials into the job, omit `oidc-audience` and
set `bearer-token-file` to the projected file path. The action rereads the file for every request
and accepts only JWTs with `iat` and `exp` whose total lifetime is at most one hour. The two
authentication inputs are mutually exclusive. Token contents must never be supplied as action
inputs.

Publishing a GitHub release named `vX.Y.Z` builds `linux/amd64`, attaches provenance and an SBOM,
and pushes only the immutable `X.Y.Z` image tag. The workflow keylessly signs the OCI index and a
release manifest that binds its digest to the immutable action commit, then attaches the manifest
and Sigstore bundles to the GitHub release for GitOps consumption. `AWS_REGION`, `AWS_ROLE_ARN`,
`ECR_REGISTRY`, and `ECR_REPOSITORY` are repository variables; release authentication uses GitHub
OIDC.
