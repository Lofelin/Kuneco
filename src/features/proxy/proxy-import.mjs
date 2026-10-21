import {parseIproyalExport} from './iproyal-import.mjs';
import {parseProxySubscription} from './subscription-import.mjs';

export function parseProxyImport(content,{subscription=false,format='auto',defaultProtocol='http'}={}){
 if(typeof content!=='string')throw new Error('请提供代理内容');
 const encrypted=/^\s*(?:proxies\s*:|\{\s*"proxies"|(?:vless|hy2|hysteria2|ss):\/\/)/im.test(content);
 const base64=/^[a-z\d+/_=\s-]+$/i.test(content.trim())&&!content.includes(',');
 return subscription||encrypted||base64?parseProxySubscription(content):parseIproyalExport(content,{format,defaultProtocol});
}
