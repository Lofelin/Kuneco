import {writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
export function createBrowserFixture({directory,localURL}){
 const settings=new Map(),cookies=new Map(),pending=[];
 const flags={defer:false,failGet:false,failPut:false};
 const cookieRequests=[],nativeDialogRequests=[];
 const api={localURL,cookieRequests,nativeDialogRequests,
  setCookieResponse(value){Object.assign(flags,value);},releaseCookies(){flags.defer=false;for(const release of pending.splice(0))release();},
  async setNativeDialogResult(result){await writeFile(path.join(directory,'native-dialog-control.json'),JSON.stringify(result));},
  async refreshNativeDialogRequests(){let text='';try{text=await readFile(path.join(directory,'native-dialog-requests.jsonl'),'utf8');}catch{}nativeDialogRequests.splice(0,nativeDialogRequests.length,...text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)));return nativeDialogRequests;},
 };
 async function route(req,res,token,body){
  const url=new URL(req.url,'http://fixture.test'),isCookie=url.pathname==='/v1/me/browser-cookies';
  if(!isCookie&&url.pathname!=='/v1/me/browser-settings')return false;
  const key=token+':'+url.search,store=isCookie?cookies:settings;
  if(isCookie){cookieRequests.push({method:req.method,url:req.url,body:body?JSON.parse(body):null});if(flags.defer)await new Promise(resolve=>pending.push(resolve));if(flags[req.method==='PUT'?'failPut':'failGet']){res.writeHead(503);res.end('{"error":"fixture cookie failure"}');return true;}}
  if(req.method==='PUT'){const next=JSON.parse(body),previous=store.get(key)||{revision:0,payload:null};if(next.revision!==previous.revision){res.writeHead(409);res.end('{"error":"fixture revision conflict"}');}else{store.set(key,{revision:previous.revision+1,payload:next.payload});res.end(JSON.stringify({revision:previous.revision+1}));}}
  else res.end(JSON.stringify(store.get(key)||{revision:0,payload:null}));
  return true;
 }
 return {api,route};
}
