// A separate primary GID selects direct egress; proxy processes keep GID 1000.
// Both routes run as UID 1000 in the SAME worker filesystem/PID namespace.
export const DIRECT_CHAT_GID='1001';
export const directChatNetworkSetup=`
iptables -C OUTPUT -m owner --gid-owner 1001 -j ACCEPT 2>/dev/null || iptables -I OUTPUT 1 -m owner --gid-owner 1001 -j ACCEPT
ip6tables -C OUTPUT -m owner --gid-owner 1001 -j ACCEPT 2>/dev/null || ip6tables -I OUTPUT 1 -m owner --gid-owner 1001 -j ACCEPT
iptables -t nat -C OUTPUT -d 127.0.0.11 -m owner --gid-owner 1001 -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:53 2>/dev/null || iptables -t nat -I OUTPUT 1 -d 127.0.0.11 -m owner --gid-owner 1001 -p udp --dport 53 -j DNAT --to-destination 127.0.0.1:53
iptables -t nat -C OUTPUT -d 127.0.0.11 -m owner --gid-owner 1001 -p tcp --dport 53 -j DNAT --to-destination 127.0.0.1:53 2>/dev/null || iptables -t nat -I OUTPUT 1 -d 127.0.0.11 -m owner --gid-owner 1001 -p tcp --dport 53 -j DNAT --to-destination 127.0.0.1:53
`;
export const engineDNSResolver=`const fs=require('fs'),net=require('net');const s=fs.readFileSync('/etc/resolv.conf','utf8');const candidates=[...[...s.matchAll(/host\\(([^)]+)\\)/g)].map(m=>m[1]),...[...s.matchAll(/^nameserver\\s+(\\S+)/gm)].map(m=>m[1]),...(s.match(/ExtServers: \\[([^\\]]+)\\]/)?.[1] || '').split(/[, ]+/)];const ip=candidates.find(ip=>net.isIP(ip)===4&&!ip.startsWith('127.')&&ip!=='::1');if(!ip)throw Error('容器引擎未提供可用DNS');process.stdout.write(ip);`;

export const directDNSRelay=`const fs=require('fs'),dgram=require('dgram'),net=require('net');const target=process.argv[1];const udp=dgram.createSocket('udp4');udp.on('message',(query,peer)=>{const upstream=dgram.createSocket('udp4');let done=false;const close=()=>{if(done)return;done=true;clearTimeout(timer);try{upstream.close()}catch{}};const timer=setTimeout(close,5000);upstream.on('error',close);upstream.on('message',answer=>{if(done)return;udp.send(answer,peer.port,peer.address);close()});upstream.send(query,53,target)});udp.on('error',e=>process.exit(e.code==='EADDRINUSE'?0:1));udp.bind(53,'127.0.0.1');const tcp=net.createServer(client=>{const upstream=net.connect(53,target);client.pipe(upstream).pipe(client);client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy());upstream.setTimeout(10000,()=>upstream.destroy())});tcp.on('error',e=>process.exit(e.code==='EADDRINUSE'?0:1));tcp.listen(53,'127.0.0.1');`;

export const directDNSReady=`const net=require('net');let attempts=0;function probe(){const s=net.connect(53,'127.0.0.1');s.once('connect',()=>{s.destroy();process.exit(0)});s.once('error',()=>{s.destroy();if(++attempts===30)process.exit(1);setTimeout(probe,50)});}probe();`;
