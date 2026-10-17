export function codexBrowserLogin(raw){
 try{
  const url=new URL(raw),redirect=new URL(url.searchParams.get('redirect_uri'));
  if(url.origin!=='https://auth.openai.com' || url.pathname!=='/oauth/authorize' || !url.searchParams.get('state'))return null;
  if(redirect.protocol!=='http:' || !['localhost','127.0.0.1'].includes(redirect.hostname) || redirect.port!=='1455' || redirect.pathname!=='/auth/callback' || redirect.username || redirect.password)return null;
  return {url:url.href,state:url.searchParams.get('state'),redirect:redirect.href};
 }catch{return null;}
}
export function matchesCodexCallback(raw,login){
 try{const url=new URL(raw),redirect=new URL(login.redirect);return url.origin===redirect.origin && url.pathname===redirect.pathname && !url.username && !url.password && url.searchParams.get('state')===login.state && Boolean(url.searchParams.get('code') || url.searchParams.get('error'));}catch{return false;}
}
// Only explicit Codex login sessions may automatically open their official OAuth URL.
export function createLoginLinkDetector(engine,onLink){
 let buffer='',opened=false;
 return chunk=>{
  if(engine!=='codex' || opened)return;
  buffer=(buffer+chunk).slice(-32768);
  const text=buffer.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
  for(const match of text.matchAll(/https:\/\/auth\.openai\.com\/oauth\/authorize\?[^\s]+(?=\s)/g)){
   const login=codexBrowserLogin(match[0]);if(login){opened=true;onLink(login.url,login);break;}
  }
 };
}
