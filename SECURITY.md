# Security policy

Report vulnerabilities privately to the ApeLogic security team. Do not open a public issue with
credential material, OIDC tokens, runtime identifiers tied to users, or control-plane responses.

The action must never log bearer tokens, inherit or forward `GITHUB_TOKEN` to an agent process,
or contact a Steward data-plane endpoint. Coding-agent processes execute only inside the governed
sandbox.

