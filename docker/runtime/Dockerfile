ARG BASE_IMAGE=node:22-bookworm-slim
FROM ${BASE_IMAGE}
ARG BASE_IMAGE
LABEL io.dingtu.base-image="${BASE_IMAGE}"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git iptables util-linux bash bash-completion coreutils findutils grep sed gawk less nano vim-tiny curl wget jq ripgrep file tree unzip zip tar gzip bzip2 xz-utils procps psmisc iproute2 iputils-ping dnsutils netcat-openbsd openssh-client rsync python3 python3-venv python3-pip make gcc g++ pkg-config man-db && rm -rf /var/lib/apt/lists/*
RUN printf '\n[ -r /usr/share/bash-completion/bash_completion ] && . /usr/share/bash-completion/bash_completion\n' >> /etc/bash.bashrc
RUN node --version && npm --version && curl --version
WORKDIR /opt/dingtu
RUN npm init -y && npm install socks@2.8.10
COPY src/proxy.mjs ./proxy.mjs
COPY docker/runtime/gateway.mjs docker/runtime/control.mjs docker/runtime/exec.mjs docker/runtime/worker.sh ./
RUN chmod 755 worker.sh && mkdir -p /workspace /data && chown node:node /workspace /data
ENV HOME=/home/node CODEX_HOME=/home/node/.codex
CMD ["sleep","infinity"]
