FROM node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS node-runtime

FROM ghcr.io/actions/actions-runner:2.336.0@sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda

ARG VERSION=0.0.0-dev
ARG REVISION=unknown
ARG SOURCE_REPOSITORY
LABEL org.opencontainers.image.title="steward-run" \
      org.opencontainers.image.description="Thin ARC runner for governed Steward jobs" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="${SOURCE_REPOSITORY}" \
      org.opencontainers.image.licenses="MIT"

USER root
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
RUN apt-get update \
    && test -n "$SOURCE_REPOSITORY" \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --only-upgrade \
       libc6=2.39-0ubuntu8.9 \
       libc-bin=2.39-0ubuntu8.9 \
       libcurl3t64-gnutls=8.5.0-2ubuntu10.13 \
       libperl5.38t64=5.38.2-3.2ubuntu0.6 \
       perl=5.38.2-3.2ubuntu0.6 \
       perl-base=5.38.2-3.2ubuntu0.6 \
       perl-modules-5.38=5.38.2-3.2ubuntu0.6 \
    && apt-get purge -y \
       curl \
       gir1.2-girepository-2.0 \
       gir1.2-glib-2.0 \
       gir1.2-packagekitglib-1.0 \
       libappstream5 \
       libgirepository-1.0-1 \
       libglib2.0-0t64 \
       libglib2.0-bin \
       libglib2.0-data \
       libgstreamer1.0-0 \
       libcurl4t64 \
       libpackagekit-glib2-18 \
       libpolkit-agent-1-0 \
       libpolkit-gobject-1-0 \
       libxmlb2 \
       packagekit \
       polkitd \
       python3-dbus \
       python3-gi \
       python3-software-properties \
       software-properties-common \
    && apt-get check \
    && ! dpkg-query -W gir1.2-glib-2.0 \
    && ! dpkg-query -W libglib2.0-0t64 \
    && ! dpkg-query -W libglib2.0-bin \
    && ! dpkg-query -W libglib2.0-data \
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
