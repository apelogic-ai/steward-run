# steward-run v0.7.2

> **v0.7.3 correction:** github-oidc-exchange policy versions 5 and 6 do
> not have `job_workflow_ref` or workflow-SHA selectors. The workflow commit
> remains an exact caller supply-chain pin, but it is not an Identity allowlist
> field. Identity v6 binds numeric owner/repository IDs plus its configured
> subject, event, and ref selectors. See the current installation guide and
> [github-oidc-exchange #82](https://github.com/apelogic-ai/github-oidc-exchange/issues/82).

This release completes the standalone OSS operator handoff without changing
the schema-3 release manifest. Its signed `image` remains the immutable public
image for both the ARC runner and governed job-container roles.

## Installation hardening

- **Breaking:** the application chart supports Kubernetes 1.32 through 1.36 inclusive and
  tests every supported minor plus both rejected boundaries.
- Helm schema validation rejects runner list overlays that omit
  `/home/runner/run.sh`, the image pull policy, the no-privilege security
  context, or CPU/memory requests and limits; it also requires pod-level
  `runAsNonRoot: true` and rejects `capabilities.add`.
- Public workflows and historical security evidence contain no private cloud
  account or registry coordinate.

## Operator controls

- Reusable workflows expose `job-timeout-minutes` with default 15 and
  `runtime-binding-timeout-minutes` with default 10; both accept whole minutes
  from 1 through 360.
- Runtime binding accepts whole-minute deadlines from 1 through 360 and is
  bounded by the selected wall clock rather than a fixed poll count.
- GitHub private vulnerability reporting is enabled and linked from
  `SECURITY.md`.

## Documentation and integration

The current installation guide is now self-contained: artifact verification,
ARC 0.14.2 preflight, existing GitHub App Secret checks, complete hardened
values, install, post-install, delivery test, upgrade, rollback, and uninstall
are in one runbook. Public GitHub.com callers may consume the upstream
customer workflow directly at the exact manifest `workflowCommit`.

Cross-repository use of a different private fork is explicitly unsupported
because the caller's `GITHUB_TOKEN` cannot be assumed to read that repository
and the workflow has no PAT/token input. Keep the selected workflow repository,
path, and 40-character commit exact in the caller. Current Identity policy
does not select that workflow claim.

Upgrade the reusable-workflow commit, action commit, image digest, and chart
package as one verified v0.7.2 handoff. Roll back by restoring the complete
v0.7.1 handoff. Change Identity only when a supported numeric-ID,
subject/event/ref, or audience policy field actually changes.
