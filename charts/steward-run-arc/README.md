# steward-run-arc application chart

This is the installable customer chart. It wraps the upstream
`gha-runner-scale-set` chart at 0.14.2 and creates one ARC runner scale set,
listener, and scoped service accounts/RBAC. The shared ARC controller and its
CRDs are prerequisites and are not owned by this release. The chart requires
an existing GitHub App Secret reference, a GitHub registration URL, and a
customer-owned runner image pinned by `sha256` digest. No credential value is
accepted in Helm values.

Default behavior is zero idle runners, five maximum, direct execution in the
digest-pinned runner image, a non-root Pod, no privilege escalation, and no
mounted Kubernetes API token. If the image registry is private, reference an
existing pull Secret in `template.spec.imagePullSecrets`. For a customer CA,
mount an operator-owned public ConfigMap in the runner Pod; the default does
not invent trust material.

Follow the [v0.4.0 installation guide](../../docs/installation-v0.4.0.md)
for prerequisites, GitHub App creation, image and chart build/publish,
values, installation, rotation, upgrade/rollback, and delivery tests. Helm
replaces lists when overlaying values, so preserve the complete runner
container entry when changing its image or adding mounts. The guide marks
live registration and governed-job evidence that is still pending.
