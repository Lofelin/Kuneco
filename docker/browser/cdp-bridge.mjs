import {spawn} from 'node:child_process';
import {readdir,readlink,lstat,mkdir,mkdtemp,rename} from 'node:fs/promises';
import path from 'node:path';

// A prior abrupt container stop can leave Chromium singleton symlinks pointing
// at an obsolete container hostname. Preserve them without following their
// destinations; never delete profile data or bypass a live browser owner.
const profile='/home/browser/profile';
await mkdir(profile,{recursive:true,mode:0o700});
for(const pid of await readdir('/proc')){
 if(!/^\d+$/.test(pid)||Number(pid)===process.pid)continue;
 let executable;try{executable=await readlink('/proc/'+pid+'/exe');}catch{continue;}
 if(/\/(?:chromium|chrome)(?: \(deleted\))?$/.test(executable))throw new Error('浏览器仍在运行，禁止恢复配置锁');
}
const locks=[];
for(const name of ['SingletonLock','SingletonCookie','SingletonSocket']){
 let info;try{info=await lstat(path.join(profile,name));}catch(error){if(error.code==='ENOENT')continue;throw error;}
 if(!info.isSymbolicLink())throw new Error('浏览器配置锁类型异常，已保留原数据');locks.push(name);
}
if(locks.length){
 const backup=await mkdtemp(path.join(profile,'.kuneco-singleton-backup-'));
 for(const name of locks)await rename(path.join(profile,name),path.join(backup,name));
}
// Anonymous fd 3/4 carry CDP. Never publish a debugging TCP port reachable by a page.
const browser=spawn('/usr/bin/chromium',[
 '--headless=new','--disable-dev-shm-usage',
 '--remote-debugging-pipe','--user-data-dir=/home/browser/profile',
 '--no-first-run','--no-default-browser-check','--disable-background-networking',
 '--disable-component-update','--disable-sync','--disable-quic',
 '--disable-features=MediaRouter,OptimizationHints',
 '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
 '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
 '--password-store=basic','--proxy-bypass-list=<-loopback>',
 '--proxy-server=http://'+process.env.KUNECO_GATEWAY_IP+':8080',
 '--lang='+process.env.KUNECO_BROWSER_LOCALE,
 'about:blank'
],{stdio:['ignore','ignore','ignore','pipe','pipe'],env:{...process.env}});
process.stdin.pipe(browser.stdio[3]);browser.stdio[4].pipe(process.stdout);
process.stdin.on('end',()=>browser.kill('SIGTERM'));
process.on('SIGTERM',()=>browser.kill('SIGTERM'));
process.on('SIGINT',()=>browser.kill('SIGTERM'));
browser.on('error',()=>process.exit(1));
browser.on('exit',code=>process.exit(code || 0));
