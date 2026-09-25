{{/*
steward-run.runnerPodSpec renders only the runner Pod spec fragment consumed by
an environment-owned ARC scale set. The caller supplies this chart's values as
the template context, for example (dict "Values" .Values.stewardRun).
*/}}
{{- define "steward-run.validate" -}}
{{- if not .Values.image.repository -}}
{{- fail "steward-run.image.repository must name an accessible OCI repository" -}}
{{- end -}}
{{- if not (regexMatch "^sha256:[0-9a-f]{64}$" .Values.image.digest) -}}
{{- fail "steward-run.image.digest must be an exact lowercase sha256 OCI digest" -}}
{{- end -}}
{{- if eq .Values.image.digest "sha256:0000000000000000000000000000000000000000000000000000000000000000" -}}
{{- fail "steward-run.image.digest must be a released immutable digest; the all-zero placeholder is invalid" -}}
{{- end -}}
{{- if .Values.trustBundle.configMapName -}}
{{- if or (gt (len .Values.trustBundle.configMapName) 253) (not (regexMatch "^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?(?:\\.[a-z0-9](?:[-a-z0-9]*[a-z0-9])?)*$" .Values.trustBundle.configMapName)) -}}
{{- fail "steward-run.trustBundle.configMapName must be a valid Kubernetes ConfigMap name" -}}
{{- end -}}
{{- if or (gt (len .Values.trustBundle.key) 253) (not (regexMatch "^[A-Za-z0-9._-]+$" .Values.trustBundle.key)) -}}
{{- fail "steward-run.trustBundle.key must name one public CA bundle key" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "steward-run.image" -}}
{{- include "steward-run.validate" . -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- end -}}

{{- define "steward-run.runnerPodSpec" -}}
{{- include "steward-run.validate" . -}}
securityContext:
{{ toYaml .Values.podSecurityContext | nindent 2 }}
{{- if .Values.imagePullSecrets }}
imagePullSecrets:
{{ toYaml .Values.imagePullSecrets | nindent 2 }}
{{- end }}
{{- if .Values.trustBundle.configMapName }}
volumes:
  - name: steward-run-trust-bundle
    configMap:
      name: {{ .Values.trustBundle.configMapName | quote }}
      items:
        - key: {{ .Values.trustBundle.key | quote }}
          path: ca.crt
{{- end }}
containers:
  - name: {{ .Values.runner.name }}
    image: {{ include "steward-run.image" . | quote }}
    imagePullPolicy: {{ .Values.image.pullPolicy }}
    command:
{{ toYaml .Values.runner.command | nindent 6 }}
{{- if .Values.trustBundle.configMapName }}
    env:
      - name: NODE_EXTRA_CA_CERTS
        value: /etc/steward-run/trust/ca.crt
    volumeMounts:
      - name: steward-run-trust-bundle
        mountPath: /etc/steward-run/trust
        readOnly: true
{{- end }}
    securityContext:
{{ toYaml .Values.containerSecurityContext | nindent 6 }}
    resources:
{{ toYaml .Values.resources | nindent 6 }}
{{- end -}}
