FROM node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS node-runtime

FROM ghcr.io/actions/actions-runner:2.334.0@sha256:b6614fce332517f74d0a76e7c762fb08e4f2ff13dcf333183397c8a5725b6e8e

ARG VERSION=0.0.0-dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="steward-run" \
      org.opencontainers.image.description="Thin ARC runner for governed Steward jobs" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/apelogic-ai/steward-run"

USER root
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
RUN node --version \
    && test -x /home/runner/run.sh \
    && test -d /home/runner/k8s \
    && rm -f /usr/bin/containerd /usr/bin/containerd-shim-runc-v2 /usr/bin/ctr \
    && rm -rf /home/runner/externals/node20/lib/node_modules/npm \
              /home/runner/externals/node24/lib/node_modules/npm

USER runner
