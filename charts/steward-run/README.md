# steward-run Helm library chart

`steward-run` is a library chart, not a runner controller. It renders the
security-hardened Pod-spec fragment for the `steward-run` runner image, which
an environment-owned GitHub Actions Runner Controller (ARC) scale-set chart
imports. It intentionally renders **no** Kubernetes resources by itself:

- no `Deployment`, `Service`, `Job`, `CronJob`, or listener;
- no runner registration, GitHub URL, labels, replica count, or GitHub App
  reference;
- no ServiceAccount, RBAC, NetworkPolicy, Secret, or credential projection.

Installing this legacy library chart directly is intentionally unsupported. A
Helm library chart is imported by a consumer chart; rendering it alone
produces no workload. The supported customer scale-set installation path is
the [installable application chart](../steward-run-arc/) and its
[versioned guide](../../docs/installation-v0.4.0.md).

Those concerns are environment authority: ARC installation, GitHub
registration, runner scale, workload identity, certificate projection, egress,
and image-pull credentials belong in the operator's environment layer. The
runner image remains an immutable, MIT-licensed product artifact owned by
this repository. No public runner image or OCI chart is currently published;
the default repository is empty and must be set to an accessible coordinate.
The chart has no AWS, ECR, GitHub App, or internal GitOps
dependency; a customer-owned ARC scale set supplies those deployment choices.

## Required release input

Set `image.repository` to a repository the cluster can pull and `image.digest`
to the exact lowercase OCI digest recorded in the corresponding release
evidence. A tag is never used at this boundary. The default empty repository
and digest deliberately fail when a consumer renders the Pod fragment. The
old ApeLogic handoff is not a customer artifact: an independent build has
its **own** digest and evidence. See the [installation guide](../../docs/installation-v0.4.0.md).

`imagePullSecrets` contains only existing Secret names. The chart never creates
or accepts registry credential values.

The runner writes its GitHub Actions work directory, so
`readOnlyRootFilesystem` is intentionally `false`. The chart still requires a
non-root UID/GID of `1001`, RuntimeDefault seccomp, no privilege escalation,
no Linux capabilities, and `privileged: false`. The environment remains
responsible for the runner Pod's ServiceAccount/RBAC and the ARC Kubernetes
container-hook volume mounts.

## Import into an ARC values wrapper

After obtaining the exact source under a separate grant and packaging the
versioned chart locally (or publishing that package to a customer-owned OCI
registry), a customer/operator wrapper chart may declare this library as a
dependency and pass only its runner-image contract under `stewardRun`:

```yaml
# Chart.yaml
dependencies:
  - name: steward-run
    version: 0.1.0
    repository: oci://registry.customer.example/charts
```

```yaml
# values.yaml
stewardRun:
  image:
    repository: registry.customer.example/steward-run
    digest: sha256:<64 lowercase hex characters>
    pullPolicy: IfNotPresent
  imagePullSecrets: [] # or existing Secret names if the customer registry requires auth
  resources:
    requests:
      cpu: 250m
      memory: 512Mi
    limits:
      cpu: "1"
      memory: 1Gi
```

The wrapper can use the named template while it renders the ARC-provided job
Pod hook or runner template:

```gotemplate
spec:
{{ include "steward-run.runnerPodSpec" (dict "Values" .Values.stewardRun) | nindent 2 }}
```

ARC's own Helm chart and the customer/operator-owned environment values then attach the
required GitHub registration, runner labels, scale policy, runner
ServiceAccount/RBAC, CA ConfigMap, container hook, and egress policy. Do not
put those values in this product chart.

## Upgrade expectations

1. Read the release handoff and select the new immutable runner-image digest.
2. Update the environment-owned ARC wrapper/values in a reviewed GitOps change.
3. Allow already-running GitHub jobs to finish on the old image; newly created
   ephemeral runner Pods receive the new digest.
4. Roll back by restoring the prior verified digest in the environment layer.

There is no Helm-managed persistent steward-run workload to roll back. Render
the consumer with its real ARC chart and environment values before applying it.
