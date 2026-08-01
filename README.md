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

