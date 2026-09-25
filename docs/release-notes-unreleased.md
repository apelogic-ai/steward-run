# Unreleased: task-authentication discovery

This change is backward compatible. With no explicit authentication inputs,
steward-run now discovers exactly one Identity issuer from the configured
Steward resource, discovers its exchange endpoint and GitHub OIDC audience,
and uses normal system trust.

Existing `identity-exchange-url`, `identity-exchange-audience`, and
`steward-ca-certificate-file` callers continue to execute the same explicit
path. The inputs are optional, default to empty, and now emit value-free
deprecation warnings. They remain supported until a separately authorized
major-version migration removes them.

The ARC chart adds a validated operator-owned ConfigMap reference shape for a
public CA bundle. The library chart adds `trustBundle.configMapName` and
`trustBundle.key`. Both leave the runner unchanged for publicly trusted
endpoints and never accept certificate contents or private keys in values.

Upgrade by publishing Steward and Identity metadata first, upgrading one
coherent steward-run release, verifying the explicit path, then removing the
compatibility inputs. Roll back discovery by restoring those inputs. Roll back
the release by restoring the prior workflow commit, image digest, chart, and
values together. There is no steward-run database migration or persistent-data
change in this release.
