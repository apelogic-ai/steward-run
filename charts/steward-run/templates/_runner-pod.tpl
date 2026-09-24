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
containers:
  - name: {{ .Values.runner.name }}
    image: {{ include "steward-run.image" . | quote }}
    imagePullPolicy: {{ .Values.image.pullPolicy }}
    command:
{{ toYaml .Values.runner.command | nindent 6 }}
    securityContext:
{{ toYaml .Values.containerSecurityContext | nindent 6 }}
    resources:
{{ toYaml .Values.resources | nindent 6 }}
{{- end -}}
