#!/bin/sh
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
# This bootstrap is the only privileged process. Chromium never has NET_ADMIN.
iptables -t raw -A OUTPUT -d 127.0.0.11 -j DROP
iptables -t raw -A OUTPUT -p udp --dport 53 -j DROP
iptables -t raw -A OUTPUT -p tcp --dport 53 -j DROP
ip6tables -t raw -A OUTPUT -p udp --dport 53 -j DROP
ip6tables -t raw -A OUTPUT -p tcp --dport 53 -j DROP
iptables -P OUTPUT DROP
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -d "$KUNECO_GATEWAY_IP" -p tcp --dport 8080 -j ACCEPT
ip6tables -P OUTPUT DROP
ip6tables -A OUTPUT -o lo -j ACCEPT
# No inbound browser debugging socket exists: CDP uses anonymous pipes only.
iptables -P INPUT DROP
iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -P INPUT DROP
ip6tables -A INPUT -i lo -j ACCEPT
chown 1000:1000 /home/browser
setpriv --reuid=1000 --regid=1000 --init-groups --bounding-set=-all --no-new-privs \
 sh -c 'umask 077; mkdir -p /home/browser/downloads /home/browser/uploads; chmod 700 /home/browser/downloads /home/browser/uploads'
# Require working unprivileged user namespaces before reporting readiness.
# Never fall back to --no-sandbox when the host kernel / seccomp policy rejects it.
setpriv --reuid=1000 --regid=1000 --init-groups --bounding-set=-all --no-new-privs \
 unshare --user --map-root-user true
touch /tmp/kuneco-browser-ready
exec setpriv --reuid=1000 --regid=1000 --init-groups --bounding-set=-all sleep infinity
