// OpenSSH ProxyCommand. No credentials are passed on the command line.
const net=require('node:net'),tls=require('node:tls'),fs=require('node:fs');
const [host,portText]=process.argv.slice(2),port=Number(portText);
if(!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host||'')||!Number.isInteger(port)||port<1||port>65535)process.exit(2);
let proxy=process.env.KUNECO_GIT_PROXY_URL;
if(proxy===undefined){try{proxy=fs.readFileSync('/tmp/dingtu-chat-proxy','utf8').trim();}catch{proxy=process.env.HTTPS_PROXY||process.env.https_proxy||process.env.ALL_PROXY||process.env.all_proxy||'';}}
let socket,buffer=Buffer.alloc(0),stage='connect',address;
const fail=()=>{process.stderr.write('Git SSH 网络连接失败\n');socket?.destroy();process.stdin.destroy();process.exit(1);};
function ready(){stage='ready';socket.setTimeout(0);socket.removeAllListeners('data');if(buffer.length)process.stdout.write(buffer);buffer=Buffer.alloc(0);process.stdin.pipe(socket);socket.pipe(process.stdout);process.stdin.on('end',()=>socket.end());}
try{
 if(!proxy){socket=net.connect({host,port},()=>ready());}
 else{
  address=new URL(proxy);if(!['http:','https:','socks5:','socks5h:'].includes(address.protocol))throw Error('proxy');
  const connect=()=>{if(address.protocol.startsWith('socks')){stage='greeting';socket.write(Buffer.from([5,1,address.username?2:0]));}else{stage='headers';const auth=address.username?'Proxy-Authorization: Basic '+Buffer.from(decodeURIComponent(address.username)+':'+decodeURIComponent(address.password)).toString('base64')+'\r\n':'';socket.write('CONNECT '+host+':'+port+' HTTP/1.1\r\nHost: '+host+':'+port+'\r\n'+auth+'\r\n');}};
  const opts={host:address.hostname,port:Number(address.port)||(address.protocol==='https:'?443:address.protocol.startsWith('socks')?1080:80)};
  socket=address.protocol==='https:'?tls.connect({...opts,servername:address.hostname},connect):net.connect(opts,connect);
  socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);if(buffer.length>65536)return fail();
   if(stage==='headers'){const end=buffer.indexOf('\r\n\r\n');if(end<0)return;if(!/^HTTP\/1\.[01] 200\b/.test(buffer.toString('ascii',0,end)))return fail();buffer=buffer.subarray(end+4);return ready();}
   const request=()=>{stage='reply';const name=Buffer.from(host);socket.write(Buffer.concat([Buffer.from([5,1,0,3,name.length]),name,Buffer.from([port>>8,port&255])]));};
   if(stage==='greeting'&&buffer.length>=2){const method=buffer[1];buffer=buffer.subarray(2);if(method===0)request();else if(method===2){const u=Buffer.from(decodeURIComponent(address.username)),p=Buffer.from(decodeURIComponent(address.password));if(u.length>255||p.length>255)return fail();stage='auth';socket.write(Buffer.concat([Buffer.from([1,u.length]),u,Buffer.from([p.length]),p]));}else return fail();}
   if(stage==='auth'&&buffer.length>=2){if(buffer[1]!==0)return fail();buffer=buffer.subarray(2);request();}
   if(stage==='reply'&&buffer.length>=5){if(buffer[0]!==5||buffer[1]!==0)return fail();const length=buffer[3]===1?10:buffer[3]===4?22:buffer[3]===3?7+buffer[4]:0;if(!length)return fail();if(buffer.length<length)return;buffer=buffer.subarray(length);ready();}
  });
 }
 socket.setTimeout(15000,fail);socket.on('error',fail);socket.on('close',()=>{if(stage!=='ready')fail();else process.stdin.destroy();});
}catch{fail();}
