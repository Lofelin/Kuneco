// Executed inside the selected environment. Only public key material leaves it.
export const gitInfoScript = String.raw`
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const generate=process.argv[1]==='generate';
const run=(args)=>cp.execFileSync('ssh-keygen',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const home=os.homedir(),dir=path.join(home,'.ssh'),key=path.join(dir,'id_ed25519');
const version=cp.execFileSync('git',['--version'],{encoding:'utf8'}).trim();
if(generate){
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const lock=path.join(dir,'.kuneco-key-lock');
 try{fs.mkdirSync(lock,{mode:0o700});}catch{throw new Error('密钥正在生成，请稍后刷新');}
 try{
  if(!fs.existsSync(key)){
   if(fs.existsSync(key+'.pub'))throw new Error('已有同名公钥但缺少私钥，请先检查环境中的 SSH 配置');
   run(['-q','-t','ed25519','-N','','-C','kuneco','-f',key]);
  }
  if(!fs.existsSync(key+'.pub'))fs.writeFileSync(key+'.pub',run(['-y','-P','','-f',key])+'\n',{mode:0o644});
 }finally{fs.rmdirSync(lock);}
}
let publicKey='',keyPath='';
for(const name of ['id_ed25519','id_rsa','id_ecdsa']){
 const candidate=path.join(dir,name+'.pub');
 try{const value=fs.readFileSync(candidate,'utf8').trim();if(/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-\S+)\s+[A-Za-z0-9+/=]+(?:\s.*)?$/.test(value)){publicKey=value;keyPath=candidate;break;}}catch(error){if(error.code!=='ENOENT')throw error;}
}
console.log(JSON.stringify({version,publicKey,keyPath}));
`;
export async function readGitInfo(execute,{generate=false}={}){
 const raw=await execute(['node','-e',gitInfoScript,generate?'generate':'read']);
 return JSON.parse(raw);
}
