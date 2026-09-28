# Security policy

Report vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/apelogic-ai/steward-run/security/advisories/new).
Do not open a public issue with credential material, OIDC tokens, runtime identifiers tied to
users, or control-plane responses. The private advisory is the supported reporting and
coordination channel; include affected versions, reproduction steps, and impact when available.

The action must never log bearer tokens, inherit or forward `GITHUB_TOKEN` to an agent process,
or contact a Steward data-plane endpoint. Coding-agent processes execute only inside the governed
sandbox.
