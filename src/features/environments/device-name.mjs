import {execFile} from 'node:child_process';
import {hostname} from 'node:os';
import {promisify} from 'node:util';

const run=promisify(execFile);
export async function deviceName({platform=process.platform,hostName=hostname,execute=run}={}){
 if(platform==='darwin')try{
  const {stdout}=await execute('/usr/sbin/scutil',['--get','ComputerName'],{timeout:2000,maxBuffer:65536});
  if(stdout.trim())return stdout.trim();
 }catch{}
 return hostName().trim() || '本机环境';
}
