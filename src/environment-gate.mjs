import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export const policy = JSON.parse(await readFile(new URL('./data/environment-policy.json',import.meta.url),'utf8'));
export function evaluateEnvironment({timeZone,languages,effectiveTimeZone = timeZone,error} = {}) {
  const reasons = [];
  if(error) reasons.push('系统环境读取失败，禁止使用');
  if(!Array.isArray(languages) || !languages.length || typeof languages[0] !== 'string' || !/^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(languages[0])) reasons.push('无法确定系统语言');
  else if(/^zh(?:-|$)/i.test(languages[0])) reasons.push('系统首选语言为中文');
  let zone = timeZone; const visited = new Set();
  while(zone && !policy.zones[zone] && policy.aliases[zone] && !visited.has(zone)) { visited.add(zone); zone = policy.aliases[zone]; }
  const countries = policy.zones[zone] || [];
  if(!countries.length) reasons.push('时区无法映射到国家或地区（包括 UTC 等通用时区）');
  else if(policy.deniedZones.includes(zone) || countries.some(country=>!policy.supported.includes(policy.parents[country] || country))) reasons.push('时区所属地区不在本地保存的官方支持地区名单中');
  if(effectiveTimeZone !== timeZone) reasons.push('进程 TZ 覆盖与系统时区不一致');
  return {allowed:reasons.length===0,timeZone:timeZone || '未知',effectiveTimeZone:effectiveTimeZone || '未知',languages:languages || [],countries,reasons,checkedAt:new Date().toISOString(),policyDate:policy.reviewedAt};
}
export async function readSystemEnvironment({executable=process.execPath,platform=process.platform,env=process.env} = {}) {
  try {
    if(platform !== 'darwin') throw new Error('Unsupported system reader');
    const probe = 'console.log(JSON.stringify({timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}))';
    const baseEnv = {...env,ELECTRON_RUN_AS_NODE:'1'}; delete baseEnv.TZ;
    const [system, effective, languageOutput] = await Promise.all([
      exec(executable,['-e',probe],{env:baseEnv,timeout:5000}),
      exec(executable,['-e',probe],{env:{...env,ELECTRON_RUN_AS_NODE:'1'},timeout:5000}),
      exec('/usr/bin/defaults',['read','-g','AppleLanguages'],{timeout:5000})
    ]);
    const languages = [...languageOutput.stdout.matchAll(/"([a-zA-Z0-9-]+)"|^\s*([a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)*)\s*,?\s*$/gm)].map(match=>match[1] || match[2]);
    return evaluateEnvironment({timeZone:JSON.parse(system.stdout).timeZone,effectiveTimeZone:JSON.parse(effective.stdout).timeZone,languages});
  } catch { return evaluateEnvironment({error:true}); }
}
