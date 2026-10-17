import {defaultAccountAvatar} from './account-avatar.mjs';
import {encodeChatPayload,decodeChatPayload} from './chat-object-store.mjs';
import http from 'node:http';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,rename,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';

export function accountServerURL(value) {
  const url=new URL(value);
  if(url.username || url.password || url.search || url.hash || url.pathname!=='/' || (url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('账号服务地址必须是 HTTPS 或本机 HTTP 地址');
  return url.origin;
}
// Explicit agents do not inherit HTTP_PROXY/HTTPS_PROXY or the app gateway.
export async function directRequest(url,{method='GET',body,token,signal}={}) {
  const target=new URL(url),client=target.protocol==='https:'?https:http;
  if(!['https:','http:'].includes(target.protocol))throw new Error('不支持的账号接口');
  const agent=target.protocol==='https:'?new https.Agent({keepAlive:false}):new http.Agent({keepAlive:false});
  try{return await new Promise((resolve,reject)=>{
    const data=body===undefined?undefined:Buffer.from(JSON.stringify(body));
    const headers={'user-agent':'FixedEgressWorkspace/0.1','accept':'application/json'};
    if(data){headers['content-type']='application/json';headers['content-length']=data.length;}if(token)headers.authorization='Bearer '+token;
    const req=client.request(target,{method,headers,agent,signal},res=>{
      const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)req.destroy(new Error('账号响应过大'));else chunks.push(chunk);});
      res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,type:res.headers['content-type'] || '',data:Buffer.concat(chunks)}));
    });req.setTimeout(15000,()=>req.destroy(new Error('账号服务连接超时')));req.on('error',reject);req.end(data);
  });}finally{agent.destroy();}
}
export class AccountClient extends EventEmitter {
  constructor({serverURL,sessionFile,storage,openExternal,directIP,returnURL}){super();this.serverURL=accountServerURL(serverURL);this.sessionFile=sessionFile;this.storage=storage;this.openExternal=openExternal;this.returnURL=returnURL;this.directIP=directIP;this.token=null;this.user=null;this.status='signed-out';this.controller=null;this.avatar=null;this.version=0;}
  state(){return {user:this.user,avatar:this.avatar || defaultAccountAvatar(this.user,this.serverURL),status:this.status,serverURL:this.serverURL};}
  changed(){this.emit('change',this.state());}
  async request(route,options={}) {
    let res;try{res=await directRequest(this.serverURL+route,{token:this.token,...options});}catch(error){if(error.name==='AbortError')throw error;throw new Error('账号服务暂不可用，请确认 Go 服务已启动');}
    let data;try{data=JSON.parse(res.data.toString());}catch{throw new Error('账号服务响应格式错误');}
    if(res.status>=400){const error=new Error(data.error || '账号请求失败');error.status=res.status;throw error;}return data;
  }
  async persist(){
    if(!this.storage.isEncryptionAvailable())throw new Error('系统凭据存储不可用，无法保存登录会话');
    await mkdir(path.dirname(this.sessionFile),{recursive:true,mode:0o700});
    const secret=this.storage.encryptString(JSON.stringify({token:this.token,serverURL:this.serverURL,user:this.profileToken===this.token && this.user?{id:this.user.id,name:this.user.name,email:this.user.email,username:this.user.username,avatarUrl:this.user.avatarUrl}:null}));
    await writeFile(this.sessionFile+'.tmp',secret,{mode:0o600});await rename(this.sessionFile+'.tmp',this.sessionFile);
  }
  async profile(signal){
    const token=this.token,version=this.version;const user=await this.request('/v1/me',{signal});let avatar=null;
    if(this.token!==token || this.version!==version)throw new Error('账号已变化');
    try{const image=await directRequest(this.serverURL+'/v1/me/avatar',{token:this.token,signal});if(image.status===200 && /^image\/(png|jpeg|webp)$/.test(image.type))avatar=`data:${image.type};base64,${image.data.toString('base64')}`;}catch{}
    if(signal?.aborted || this.token!==token || this.version!==version)throw new Error('账号已变化');this.user=user;this.profileToken=token;this.avatar=avatar;this.status='signed-in';await this.persist();this.changed();return this.state();
  }
  async restore(){
    let cachedUser=null;
    try{const raw=this.storage.decryptString(await readFile(this.sessionFile));const saved=JSON.parse(raw);if(saved.serverURL!==this.serverURL || typeof saved.token!=='string')throw new Error('无效登录信息');this.token=saved.token;if(saved.user && typeof saved.user.id==='string')cachedUser=saved.user;}catch{this.changed();return this.state();}
    try{return await this.profile();}catch(error){this.user=null;if(error.status===401){this.token=null;await rm(this.sessionFile,{force:true});this.status='signed-out';}else{this.user=cachedUser;this.status='offline';}this.changed();return this.state();}
  }
  async passwordLogin(credentials){
    if(typeof credentials.password!=='string' || credentials.password!==credentials.confirmPassword)throw new Error('两次输入的密码不一致');
    if(this.controller)throw new Error('登录正在进行，请稍候');
    if(!this.storage.isEncryptionAvailable())throw new Error('系统凭据存储不可用，无法保存登录会话');
    const version=++this.version,controller=new AbortController();this.controller=controller;this.status='signing-in';this.changed();
    try{const result=await this.request('/v1/auth/password',{method:'POST',body:{username:credentials.username,password:credentials.password,confirmPassword:credentials.confirmPassword},signal:controller.signal});
      if(controller.signal.aborted || this.version!==version)throw new Error('登录已取消');
      if(typeof result.token!=='string' || !result.token)throw new Error('登录响应无效');this.token=result.token;this.user=null;this.avatar=null;this.profileToken=null;
      try{await this.persist();}catch(error){await this.request('/v1/auth/logout',{method:'POST'}).catch(()=>{});this.token=null;throw error;}
      return await this.profile(controller.signal);
    }finally{this.controller=null;if(this.status!=='signed-in'){this.status=this.user?'signed-in':'signed-out';this.changed();}}
  }
  async login(credentials){
    if(credentials)return this.passwordLogin(credentials);
    if(this.controller)throw new Error('Google 登录正在进行，请在浏览器中完成或取消');
    if(!this.storage.isEncryptionAvailable())throw new Error('系统凭据存储不可用，无法保存登录会话');
    const version=++this.version;const controller=new AbortController();this.controller=controller;this.status='signing-in';this.changed();
    try{
      const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
      let directIp;try{if(this.directIP)directIp=await this.directIP();else{const probe=await directRequest('https://api.ipify.org?format=json',{signal:controller.signal});if(probe.status===200)directIp=JSON.parse(probe.data.toString()).ip;}}catch{}
      const flow=await this.request('/v1/auth/google/start',{method:'POST',body:{challenge,directIp,...(this.returnURL?{returnURL:this.returnURL}:{})},signal:controller.signal});
      const authorization=new URL(flow.authorizationUrl);if(authorization.origin!==this.serverURL || authorization.pathname!=='/v1/auth/google/authorize')throw new Error('登录跳转地址无效');
      await this.openExternal(authorization.toString());const deadline=Date.now()+600000;
      while(Date.now()<deadline){
        if(controller.signal.aborted)throw new Error('登录已取消');
        const result=await this.request('/v1/auth/google/poll',{method:'POST',body:{flowId:flow.flowId,verifier},signal:controller.signal});
        if(result.status==='complete'){
          if(controller.signal.aborted || this.version!==version)throw new Error('登录已取消');this.token=result.token;this.user=null;this.avatar=null;this.profileToken=null;
          try{await this.persist();}catch(error){await this.request('/v1/auth/logout',{method:'POST'}).catch(()=>{});this.token=null;throw error;}
          return await this.profile(controller.signal);
        }
        await new Promise(resolve=>{const timer=setTimeout(done,1200);function done(){clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();}controller.signal.addEventListener('abort',done,{once:true});});
      }
      throw new Error('Google 登录超时，请重试');
    }finally{this.controller=null;if(this.status!=='signed-in'){this.status=this.user?'signed-in':'signed-out';this.changed();}}
  }
  cancel(){this.controller?.abort();}
  async logout(){
    this.version++;this.cancel();let serverRevoked=true;
    try{if(this.token)await this.request('/v1/auth/logout',{method:'POST'});}catch{serverRevoked=false;}
    this.token=null;this.user=null;this.avatar=null;this.status='signed-out';await rm(this.sessionFile,{force:true});this.changed();return {serverRevoked};
  }
  async updateProfile(value){if(!this.user)throw new Error("请先登录");const owner=this.user.id,version=this.version;await this.request("/v1/me/profile",{method:"PUT",body:value});if(this.user?.id!==owner||this.version!==version)throw new Error("保存时账号已变化");return this.profile();}
  async chats(){if(!this.user)throw new Error('请先登录');const owner=this.user.id,version=this.version,token=this.token;const result=await this.request('/v1/me/chats');result.payload=await decodeChatPayload(result.payload,async(id,environment)=>{if(this.user?.id!==owner || this.version!==version)throw new Error('对话账号已变化');return this.request('/v1/me/chat-objects/'+encodeURIComponent(environment)+'/'+id);});if(this.user?.id!==owner || this.version!==version || this.token!==token)throw new Error('对话账号已变化');return result;}
  async runtimes(host){if(!this.user)return null;return (await this.request('/v1/me/runtimes?host='+encodeURIComponent(host))).registry;}
  async deleteLocalEnvironment(host){if(!this.user)throw new Error('请先登录');return this.request('/v1/me/local-environment?host='+encodeURIComponent(host),{method:'DELETE'});}
  async saveRuntimes(registry,owner){if(!this.user || this.user.id!==owner)throw new Error('运行时账号已变化');await this.request('/v1/me/runtimes',{method:'PUT',body:registry});if(this.user?.id!==owner)throw new Error('运行时账号已变化');}
  async saveChats(snapshot,owner){if(!this.user || this.user.id!==owner)throw new Error('对话账号已变化');const version=this.version,token=this.token;const payload=await encodeChatPayload(snapshot.payload,async(id,value,environment)=>{if(this.user?.id!==owner || this.version!==version || this.token!==token)throw new Error('对话账号已变化');await this.request('/v1/me/chat-objects/'+encodeURIComponent(environment)+'/'+id,{method:'PUT',body:value});});if(this.user?.id!==owner || this.version!==version || this.token!==token)throw new Error('对话账号已变化');const result=await this.request('/v1/me/chats',{method:'PUT',body:{...snapshot,payload}});if(this.user?.id!==owner || this.version!==version || this.token!==token)throw new Error('对话账号已变化');return result;}
  async proxy(){if(!this.user)throw new Error('请先登录');return (await this.request('/v1/me/proxy')).proxy;}
  async saveProxy(config,userID){
    if(!this.user || (userID && userID!==this.user.id))throw new Error('登录账号已变化，请重新填写');
    const owner=this.user.id;await this.request('/v1/me/proxy',{method:'PUT',body:config});
    if(this.user?.id!==owner)throw new Error('保存时账号已变化');return {saved:true,userId:owner};
  }
}
