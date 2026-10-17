import http from 'node:http';
import {readFileSync} from 'node:fs';
const logoURL='data:image/png;base64,'+readFileSync(new URL('./assets/brand/kuneco-mark.png',import.meta.url)).toString('base64');
import {randomBytes} from 'node:crypto';
// This endpoint only raises the desktop window; authentication stays in the PKCE poll flow.
export async function createDesktopReturn(onOpen){
 const secret=randomBytes(32).toString('hex'),route='/auth/return/'+secret;
 const server=http.createServer((request,response)=>{
  if(request.method!=='GET' || request.url!==route || request.headers.host!==`127.0.0.1:${server.address().port}`){response.writeHead(404);response.end();return;}
  response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'"});
  onOpen();response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>已打开Kuneco</title><link rel="icon" type="image/png" href="'+logoURL+'"><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;}body{background:#fafafa;color:#202127;font-family:system-ui,sans-serif}.return-viewport{position:fixed;inset:0;display:flex;overflow:auto;padding:24px}main{max-width:514px;flex:none;margin:auto;padding:24px 36px;text-align:center;background:white;border:1px solid #e5e5e9;border-radius:12px;box-shadow:0 1px 3px #0001}.kuneco-logo{display:block;width:48px;height:48px;object-fit:contain;margin:0 auto 16px}h1{font-size:24px;margin:0 0 12px}p{color:#777883;font-size:14px}</style><body><div class="return-viewport"><main><img class="kuneco-logo" src="'+logoURL+'" alt="Kuneco" width="48" height="48"><h1>已打开Kuneco</h1><p>登录已完成，可以关闭此页面。</p></main></div></body></html>');
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});server.unref();
 return {url:`http://127.0.0.1:${server.address().port}${route}`,close:()=>server.close()};
}
