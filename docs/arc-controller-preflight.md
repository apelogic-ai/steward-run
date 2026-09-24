# ARC controller preflight

Run the released `steward-run-arc-preflight.mjs` before creating the GitHub
registration Secret or installing the runner scale set. It performs read-only
Kubernetes API calls, prints no Secret or token data, and supports both human
and JSON output.

For the standard ARC controller Helm release:

```sh
node ./steward-run-arc-preflight.mjs \
  --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" \
  --namespace arc-system --release-name arc
```

This verifies namespace `arc-system`, Deployment and Helm release
`arc-gha-rs-controller`, ServiceAccount `arc-gha-rs-controller`, and exact ARC
controller compatibility at 0.14.2. If the controller chart sets
`serviceAccount.name`, pass that exact value with `--service-account-name`.
Copy the emitted `controllerServiceAccount` values into the final chart values.

After installing the scale set but before dispatching a workload, verify its
manager RoleBinding points at the same controller identity:

```sh
node ./steward-run-arc-preflight.mjs \
  --kubeconfig "$KUBECONFIG_FILE" --context "$KUBE_CONTEXT" \
  --namespace arc-system --release-name arc \
  --runner-namespace arc-runners --runner-scale-set-name steward-run \
  --output json
```

A successful JSON result has `"status": "ok"` and
`"runnerLinkage": "verified"`. Failures exit nonzero and return stable codes,
including `controller-namespace-not-found`,
`controller-deployment-not-found`, `controller-service-account-not-found`,
`controller-release-mismatch`, `controller-service-account-mismatch`,
`arc-version-incompatible`, and `runner-linkage-mismatch`.

## Minimum read-only access

The caller needs only these existing-object reads; it does not need cluster
admin, mutation verbs, Secret access, or token access:

| Scope | API resource | Verbs | Needed for |
| --- | --- | --- | --- |
| Cluster | core `namespaces` | `get` | Controller and optional runner namespace existence |
| Controller namespace | apps `deployments` | `get` | Release, version, and Pod ServiceAccount identity |
| Controller namespace | core `serviceaccounts` | `get` | Exact controller ServiceAccount existence |
| Runner namespace, optional | rbac `rolebindings` | `list` | Exact scale-set manager linkage |

Confirm the currently selected identity can perform the reads without exposing
credentials:

```sh
kubectl auth can-i get namespace/arc-system
kubectl auth can-i get deployment/arc-gha-rs-controller -n arc-system
kubectl auth can-i get serviceaccount/arc-gha-rs-controller -n arc-system
kubectl auth can-i list rolebindings.rbac.authorization.k8s.io -n arc-runners
```

The preflight never creates, patches, deletes, annotates, or labels cluster
objects. Providing the optional runner arguments only adds the RoleBinding
read; omit them for the clean-room controller check before installation.
