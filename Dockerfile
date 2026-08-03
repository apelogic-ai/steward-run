FROM node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS node-runtime

FROM ghcr.io/actions/actions-runner:2.336.0@sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda

ARG VERSION=0.0.0-dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="steward-run" \
      org.opencontainers.image.description="Thin ARC runner for governed Steward jobs" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/apelogic-ai/steward-run"

USER root
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y \
    && apt-get purge -y curl libcurl4t64 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && node --version \
    && test -x /home/runner/run.sh \
    && test -d /home/runner/k8s \
    && rm -f /usr/bin/containerd /usr/bin/containerd-shim-runc-v2 /usr/bin/ctr /usr/bin/docker /usr/bin/docker-init /usr/bin/docker-proxy /usr/bin/dockerd /usr/bin/runc \
    && rm -rf /usr/local/lib/docker \
              /home/runner/externals/node20/lib/node_modules/npm \
              /home/runner/externals/node24/lib/node_modules/npm

USER runner
