import {readFileSync} from 'node:fs';
import {domainToASCII} from 'node:url';
const chinaDomains=new Set(JSON.parse(readFileSync(new URL('./data/china-domains.json',import.meta.url),'utf8')));
export function isChinaDomain(host){
 let name=domainToASCII(String(host).toLowerCase().replace(/\.$/,''));
 while(name){if(chinaDomains.has(name))return true;const dot=name.indexOf('.');if(dot<0)break;name=name.slice(dot+1);}
 return false;
}
export function browserRoute(mode,url){
 if(mode==='direct')return 'direct';
 return 'proxy';
}
