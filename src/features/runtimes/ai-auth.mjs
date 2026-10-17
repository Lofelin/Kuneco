import {createRestrictedCCSpawner} from './cc-network-guard.mjs';
import {proxyEnvironment} from '../proxy/proxy.mjs';
export function parseAuthStatus(engine,{stdout='',stderr='',code=0}={}) {
  if(engine==='cc') {
    try {const value=JSON.parse(stdout);if(typeof value.loggedIn==='boolean')return{state:value.loggedIn?'signed-in':'signed-out',method:typeof value.authMethod==='string'?value.authMethod:null,accountName:value.loggedIn?(typeof value.name==='string'?value.name:typeof value.email==='string'?value.email:null):null};}catch{}
  } else {
    const text=stdout+'\n'+stderr;
    if(code===0 && /logged in/i.test(text))return{state:'signed-in',method:/chatgpt/i.test(text)?'ChatGPT':/api key/i.test(text)?'API key':null};
    if(/not logged in|not signed in/i.test(text))return{state:'signed-out',method:null};
  }
  return{state:'unknown',method:null};
}
export async function detectAIAuth({engine,executable,gateway,spawnProcess}) {
  const checkedAt=new Date().toISOString();
  if(!executable)return{state:'not-installed',checkedAt};
  let child,timer;
  try {
    const env=proxyEnvironment(process.env,gateway?.url || 'http://127.0.0.1:1');
    if(engine==='codex'){delete env.OPENAI_API_KEY;delete env.CODEX_API_KEY;delete env.OPENAI_BASE_URL;}
    const launch=spawnProcess || createRestrictedCCSpawner({port:gateway?.port || 1});
    child=launch({command:executable,args:engine==='cc'?['auth','status','--json']:['login','status'],cwd:process.cwd(),env});
    const result=await new Promise((resolve,reject)=>{
      let stdout='',stderr='';timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('timeout'));},8000);
      child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>65536)child.kill('SIGTERM');});
      child.stderr?.on('data',chunk=>{stderr+=chunk;if(stderr.length>65536)child.kill('SIGTERM');});
      child.once('error',reject);child.once('close',code=>resolve(parseAuthStatus(engine,{stdout,stderr,code})));child.stdin.end();
    });
    return{...result,checkedAt};
  }catch{return{state:'unknown',method:null,checkedAt};}
  finally{clearTimeout(timer);}
}
