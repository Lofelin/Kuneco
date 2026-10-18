import {readFile} from 'node:fs/promises';
export async function gitOperationPayload(action,value,context){
 return {action,value,context,bridge:await readFile(new URL('./git-proxy-bridge.cjs',import.meta.url),'utf8'),helper:await readFile(new URL('./git-credential-helper.cjs',import.meta.url),'utf8')};
}
export const gitOperationsScript=`(${gitOperations.toString()})()`;
function gitOperations(){
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
 let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{raw+=s;if(raw.length>262144)process.exit(1);});
 process.stdin.on('end',async()=>{
  let secrets=[];
  try{
   const {action,value={},context={},bridge,helper}=JSON.parse(raw);
   const root=context.root || path.join(os.homedir(),'.config','kuneco-git');
   const config=path.join(root,'config'),stateFile=path.join(root,'state.json'),credentialsFile=path.join(root,'credentials.json');
   fs.mkdirSync(root,{recursive:true,mode:0o700});
   const atomic=(file,value,mode=0o600)=>{const tmp=file+'.'+crypto.randomUUID();fs.writeFileSync(tmp,value,{mode});fs.renameSync(tmp,file);};
   const read=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw Error('Git 配置无法读取');}};
   const state=read(stateFile,{}),credentials=read(credentialsFile,{});secrets=Object.values(credentials).map(x=>x.token);if(value.token)secrets.push(value.token);
   const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
   const node='env ELECTRON_RUN_AS_NODE=1 '+quote(process.execPath);
   atomic(path.join(root,'proxy.cjs'),bridge);atomic(path.join(root,'credential.cjs'),helper);
   const git=(args,options={})=>cp.execFileSync('git',args,{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe'],...options}).trim();
   const set=(key,value)=>{git(['config','--file',config,key,value]);};
   let repositoryRoot='',repositoryGitDir='',repositoryConfig='';if(context.project)try{repositoryRoot=git(['-C',context.project,'rev-parse','--show-toplevel']);repositoryGitDir=git(['-C',context.project,'rev-parse','--absolute-git-dir']);repositoryConfig=path.join(root,'repositories',crypto.createHash('sha256').update(repositoryGitDir).digest('hex')+'.config');}catch{}
   const clean=(value,max=200)=>{if(typeof value!=='string'||value.length>max||/[\r\n\0]/.test(value))throw Error('配置值无效');return value.trim();};
   const host=(value)=>{const text=clean(value,253).toLowerCase();if(!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/.test(text))throw Error('请输入有效域名，可附加端口');return text;};
   let keyDirectory=context.local?path.join(root,'keys'):path.join(os.homedir(),'.ssh');fs.mkdirSync(keyDirectory,{recursive:true,mode:0o700});
   const keys=()=>fs.readdirSync(keyDirectory).filter(f=>f.endsWith('.pub')&&/^[a-zA-Z0-9_.-]+\.pub$/.test(f)).flatMap(f=>{
    const id=f.slice(0,-4),file=path.join(keyDirectory,f),publicKey=fs.readFileSync(file,'utf8').trim();
    if(!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-\S+)\s+[A-Za-z0-9+/=]+(?:\s.*)?$/.test(publicKey))return [];
    let fingerprint='';try{fingerprint=cp.execFileSync('ssh-keygen',['-lf',file,'-E','sha256'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch{return [];}
    return [{id,publicKey,fingerprint,hasPrivate:fs.existsSync(path.join(keyDirectory,id))}];
   });
   if(action==='read' && context.defaultIdentity && !state.identityInitialized){
    const defaults=context.defaultIdentity;
    for(const [key,raw] of [['user.name',defaults.name],['user.email',defaults.email]]){
     const text=typeof raw==='string'?raw.trim():'';
     if(!text||text.length>200||/[\r\n\0]/.test(text)||(key==='user.email'&&!/^[^\s@]+@[^\s@]+$/.test(text)))continue;
     let exists=false;try{git(['config','--file',config,'--get',key]);exists=true;}catch{}
     if(!exists)set(key,text);
    }
    state.identityInitialized=true;
   }
   if(action==='identity'){

    const name=clean(value.name),email=clean(value.email);if(!name||!email||!/^[^\s@]+@[^\s@]+$/.test(email))throw Error('请填写姓名和有效邮箱');
    if(value.scope==='repository'){if(!repositoryRoot)throw Error('当前项目不是 Git 仓库');fs.mkdirSync(path.dirname(repositoryConfig),{recursive:true,mode:0o700});git(['config','--file',repositoryConfig,'user.name',name]);git(['config','--file',repositoryConfig,'user.email',email]);set('includeIf.gitdir:'+repositoryGitDir+'.path',repositoryConfig);}else{set('user.name',name);set('user.email',email);}
    set('user.useConfigOnly','true');
   }else if(action==='keyCreate'){
    const id='kuneco_'+Date.now()+'_'+crypto.randomBytes(3).toString('hex'),file=path.join(keyDirectory,id);
    cp.execFileSync('ssh-keygen',['-q','-t','ed25519','-N','','-C','kuneco','-f',file],{stdio:['ignore','pipe','pipe'],timeout:15000});state.activeKey=id;
   }else if(action==='keySelect'){
    if(!keys().some(k=>k.id===value.key&&k.hasPrivate))throw Error('密钥不存在或缺少私钥');state.activeKey=value.key;
   }else if(action==='credentialSave'){
    const h=host(value.host),username=clean(value.username),token=clean(value.token,8192);if(!username||!token)throw Error('请填写用户名与 Token');credentials[h]={username,token};atomic(credentialsFile,JSON.stringify(credentials));
   }else if(action==='credentialRemove'){
    delete credentials[host(value.host)];atomic(credentialsFile,JSON.stringify(credentials));
   }
   let available=keys();if(!available.some(k=>k.id===state.activeKey&&k.hasPrivate))state.activeKey=available.find(k=>k.hasPrivate)?.id || '';
   const selected=available.find(k=>k.id===state.activeKey);
   const sshParts=['ssh','-F','/dev/null','-o','BatchMode=yes','-o','ConnectTimeout=15','-o','ConnectionAttempts=1','-o','IdentitiesOnly=yes','-o','IdentityAgent=none','-o','UserKnownHostsFile='+JSON.stringify(path.join(root,'known_hosts')),'-o','StrictHostKeyChecking=yes'];
   if(selected)sshParts.push('-i',path.join(keyDirectory,selected.id));else sshParts.push('-o','IdentityFile=none');
   sshParts.push('-o','ProxyCommand='+node+' '+quote(path.join(root,'proxy.cjs'))+' %h %p');
   set('core.sshCommand',sshParts.map(quote).join(' '));
   // Empty helper resets inherited helpers; this helper only serves exact HTTPS hosts.
   git(['config','--file',config,'--replace-all','credential.helper','']);git(['config','--file',config,'--add','credential.helper','!'+node+' '+quote(path.join(root,'credential.cjs'))]);
   if(!context.local){
    const global=path.join(os.homedir(),'.gitconfig');let includes=[];try{includes=git(['config','--file',global,'--get-all','include.path']).split('\n');}catch{}
    if(!includes.includes(config))git(['config','--file',global,'--add','include.path',config]);
   }
   atomic(stateFile,JSON.stringify(state));
   let test=null;
   if(action==='test'){
    const target=clean(value.target,2048);let url;try{url=new URL(target);}catch{throw Error('请输入 ssh://git@域名 或完整 HTTPS/SSH 仓库地址');}
    if(!['ssh:','https:'].includes(url.protocol)||url.password||url.hash||url.search)throw Error('仅支持不含密码、查询参数的 SSH 或 HTTPS 地址');
    host(url.host);if(url.protocol==='https:'&&url.username)throw Error('HTTPS 地址不应包含凭据，请在下方配置');
    const user=url.username?decodeURIComponent(url.username):'git';if(!/^[a-zA-Z0-9_.-]+$/.test(user))throw Error('SSH 用户名无效');
    if(url.protocol==='ssh:'&&!selected)throw Error('请先生成或选择 SSH 密钥');
    let proxy='';
    if(context.route==='managed'){try{proxy=fs.readFileSync('/tmp/dingtu-chat-proxy','utf8').trim();}catch{}if(!proxy)throw Error('当前环境代理尚未连接');}
    else if(context.route==='local'){proxy=context.proxy;if(!proxy)throw Error('本机环境代理尚未连接');}
    else proxy=process.env.HTTPS_PROXY||process.env.https_proxy||process.env.ALL_PROXY||process.env.all_proxy||'';
    if(proxy)secrets.push(proxy);
    const env={...process.env,GIT_CONFIG_GLOBAL:config,GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'/usr/bin/false',SSH_ASKPASS:'/usr/bin/false',KUNECO_GIT_PROXY_URL:proxy,NO_PROXY:'',no_proxy:''};
    for(const k of Object.keys(env))if(/^GIT_CONFIG_(KEY|VALUE)_|^GIT_CONFIG_COUNT$|^GIT_CONFIG_PARAMETERS$|^GIT_CONFIG$|^GIT_SSH|^GIT_DIR$|^GIT_WORK_TREE$/.test(k))delete env[k];
    for(const k of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])env[k]=proxy;
    const parts=[...sshParts];if(value.trustFirstUse===true)parts[parts.indexOf('StrictHostKeyChecking=yes')]='StrictHostKeyChecking=accept-new';
    env.GIT_SSH_COMMAND=parts.map(quote).join(' ');
    const repository=url.pathname!==''&&url.pathname!=='/';
    if(url.protocol==='https:'&&!repository)throw Error('HTTPS 检测需要完整仓库地址');
    env.GIT_CONFIG_COUNT='2';env.GIT_CONFIG_KEY_0='http.proxy';env.GIT_CONFIG_VALUE_0=proxy;env.GIT_CONFIG_KEY_1='http.followRedirects';env.GIT_CONFIG_VALUE_1='false';
    const command=repository?'git':'ssh';
    const args=repository?['ls-remote','--',target,'HEAD']:[...parts.slice(1),'-T','-p',url.port||'22',user+'@'+url.hostname];
    const result=await new Promise(resolve=>cp.execFile(command,args,{cwd:root,env,timeout:25000,maxBuffer:131072},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
    let message=(result.stderr+'\n'+(repository?'':result.stdout)).trim();if(!message&&result.error)message='Git 执行失败（'+String(result.error.code || result.error.signal || 'unknown')+'）';for(const secret of secrets)if(secret)message=message.split(secret).join('[已隐藏]');message=message.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s@]+@/gi,'$1***@');
    const authenticated=!repository&&/successfully authenticated|Welcome to GitLab/i.test(message);
    const ok=repository?!result.error:authenticated;
    const reason=ok?(repository?'仓库可读取':'SSH 认证成功'):/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/.test(message)?'主机密钥未信任或已变化':/Permission denied|Authentication failed|could not read Username/.test(message)?'认证失败':/not found|repository .*does not exist|403|404/i.test(message)?'仓库不存在或无权限':result.error?.killed?'连接超时':'连接未通过';
    test={ok,reason,detail:message.slice(-1400),route:context.route,target};
   }
   const get=key=>{try{return git(['config','--file',config,'--get',key]);}catch{return '';}};
   const repoGet=key=>{if(!repositoryRoot)return '';try{return git(['config','--file',repositoryConfig,'--get',key]);}catch{return '';}};
   console.log(JSON.stringify({repositoryAvailable:Boolean(repositoryRoot),repositoryName:repoGet('user.name'),repositoryEmail:repoGet('user.email'),name:get('user.name'),email:get('user.email'),keys:available,activeKey:state.activeKey,publicKey:selected?.publicKey||'',fingerprint:selected?.fingerprint||'',credentials:Object.entries(credentials).map(([host,item])=>({host,username:item.username})),test}));
  }catch(error){let message=error.message||'Git 操作失败';if(error.stderr)message=String(error.stderr);for(const secret of secrets)if(secret)message=message.split(secret).join('[已隐藏]');console.log(JSON.stringify({error:message.slice(0,500)}));}
 });
}
