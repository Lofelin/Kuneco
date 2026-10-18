#!/bin/sh
set -eu
# Privileged bootstrap must never resolve tools from the writable user home.
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
# Only the environment's proxy is reachable. Block Docker DNS before loopback.
# Reject original DNS destinations before Docker's resolver DNAT changes ports.
iptables -t raw -A OUTPUT -d 127.0.0.11 -j DROP
iptables -t raw -A OUTPUT -p udp --dport 53 -j DROP
iptables -t raw -A OUTPUT -p tcp --dport 53 -j DROP
ip6tables -t raw -A OUTPUT -p udp --dport 53 -j DROP
ip6tables -t raw -A OUTPUT -p tcp --dport 53 -j DROP
iptables -P OUTPUT DROP
iptables -A OUTPUT -p udp --dport 53 -j REJECT
iptables -A OUTPUT -p tcp --dport 53 -j REJECT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -d "$DINGTU_GATEWAY_IP" -p tcp --dport 8080 -j ACCEPT
ip6tables -P OUTPUT DROP
ip6tables -A OUTPUT -o lo -j ACCEPT
# Keep downloads in the environment's persistent workspace, including older volumes.
setpriv --reuid=1000 --regid=1000 --init-groups --bounding-set=-all mkdir -p /workspace/Download
touch /tmp/kuneco-worker-ready
exec setpriv --reuid=1000 --regid=1000 --init-groups --bounding-set=-all sleep infinity
