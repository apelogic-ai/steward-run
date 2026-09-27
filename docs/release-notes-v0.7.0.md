# v0.7.0: exact User Envelope selection

This additive release lets a caller select one exact active User Envelope when
the authenticated canonical user holds several. The optional action and
reusable-workflow input is:

```yaml
envelope-digest: steward:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

The selector requires Steward 0.3.0 or newer. Steward declares the client
capability minimum without source-pinning future artifacts. After both products
are released, release/integration packaging records their immutable action,
workflow, image, and chart coordinates in the signed installation BOM consumed
by GitOps and operators. Callers that omit the selector remain compatible with
older servers when one active Envelope is available.

The input is valid with either `workflow` or `invocation-path`. `steward-run`
validates the public digest shape locally and forwards it unchanged in the
corresponding `POST /v1/tasks` body. Steward resolves it only within the
authenticated owner's active Envelopes; the digest is an integrity selector,
not a bearer credential.

Existing callers may omit the input. They continue to work when exactly one
active Envelope exists. Steward rejects zero matches and returns conflict when
an unqualified caller has multiple active Envelopes.

Upgrade the action source, reusable-workflow commit, multi-platform runner
image, and `steward-run-arc` chart as one verified 0.7.0 handoff. No new secret,
runner permission, or chart value is required. Roll back by restoring the prior
0.6.0 workflow/action commit, image digest, and chart package together; callers
must then omit `envelope-digest` and have exactly one active Envelope.
