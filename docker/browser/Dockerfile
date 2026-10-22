FROM debian:bookworm-slim
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends chromium xvfb nodejs iptables util-linux locales tzdata fonts-noto-core fonts-noto-cjk ca-certificates && rm -rf /var/lib/apt/lists/* \
 && sed -i -E 's/^# (en_US.UTF-8 UTF-8|ja_JP.UTF-8 UTF-8|zh_CN.UTF-8 UTF-8|zh_TW.UTF-8 UTF-8|de_DE.UTF-8 UTF-8|fr_FR.UTF-8 UTF-8)/\1/' /etc/locale.gen && locale-gen \
 && groupadd -g 1000 browser && useradd -u 1000 -g 1000 -m browser
COPY docker/browser/entrypoint.sh /opt/kuneco/browser-entrypoint.sh
COPY docker/browser/cdp-bridge.mjs /opt/kuneco/cdp-bridge.mjs
COPY docker/browser/network-transport.mjs /opt/kuneco/network-transport.mjs
RUN chmod 755 /opt/kuneco/browser-entrypoint.sh
ENV HOME=/home/browser LANG=en_US.UTF-8 TZ=UTC
ENTRYPOINT ["/opt/kuneco/browser-entrypoint.sh"]
