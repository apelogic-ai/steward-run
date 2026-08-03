# steward-run

`steward-run` is the environment-agnostic GitHub Action and ARC runner image that translates a
live GitHub Actions job into a governed Steward sandbox run. The workspace is the only workflow
author-facing data contract.

The current API contract in `contracts/steward-run-v1.openapi.yaml` is provisional. Production
use is blocked until Steward publishes a compatible contract and implements service-principal
acting-for-user admission.

## Development

Requires Node.js 24 and Docker.

```console
npm ci
npm run check
```

Every production slice is developed test-first and committed only after its slice checks pass.
See `docs/steward-run-spec.md` for the product boundary.

## Usage

The workflow must grant `id-token: write`; artifact download and upload remain ordinary adjacent
steps. All paths are relative to `GITHUB_WORKSPACE`.

```yaml
- uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0
  with:
    name: request
    path: in
- uses: apelogic-ai/steward-run@v0.1.0
  with:
    workflow: cve-triage
    inputs: in
    outputs: results
    steward-api-url: ${{ vars.STEWARD_API_URL }}
    oidc-audience: ${{ vars.STEWARD_OIDC_AUDIENCE }}
- uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
  with:
    name: result
    path: results
```

Publishing a GitHub release named `vX.Y.Z` builds `linux/amd64`, attaches provenance and an SBOM,
and pushes only the immutable `X.Y.Z` image tag. `AWS_REGION`, `AWS_ROLE_ARN`, `ECR_REGISTRY`, and
`ECR_REPOSITORY` are repository variables; release authentication uses GitHub OIDC.
