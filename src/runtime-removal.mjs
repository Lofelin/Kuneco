import {access,realpath,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function removeCLIRuntime(engine,{home=homedir(),executable,execute=exec}={}){
 const packages={cc:['claude','@anthropic-ai/claude-code'],codex:['codex','@openai/codex'],kimi:['kimi','@moonshot-ai/kimi-code'],qwen:['qwen','@qwen-code/qwen-code'],kiro:['kiro-cli',null],doubao:['ve','@volcengine/cli']};
 if(!Object.hasOwn(packages,engine))throw new Error('未知 CLI 运行时');
 const [name,packageName]=packages[engine];
 if(!executable){for(const dir of [...new Set([...(process.env.PATH || '').split(path.delimiter),path.join(home,'.local/bin')])]){const file=path.join(dir,name);try{await access(file);executable=file;break;}catch{}}}
 if(!executable)return;
 home=await realpath(home);
 const target=await realpath(executable),native=path.join(home,'.local/share/claude');
 const launcher=path.join(await realpath(path.dirname(executable)),path.basename(executable));
 if(engine==='cc' && launcher===path.join(home,'.local/bin/claude') && target.startsWith(native+path.sep)){
  await rm(executable);await rm(native,{recursive:true,force:true});return;
 }
 // Kiro's official Linux installer writes these two binaries; keep all user data.
 if(engine==='kiro' && launcher===path.join(home,'.local/bin/kiro-cli') && target===launcher){
  const companion=path.join(home,'.local/bin/kiro-cli-chat');
  await rm(executable,{force:true});await rm(companion,{force:true});return;
 }
 let root;try{root=(await execute('npm',['root','-g'],{timeout:15000})).stdout.trim();root=await realpath(root);}catch{}
 if(packageName && root && target.startsWith(path.join(root,packageName)+path.sep)){await execute('npm',['uninstall','-g',packageName],{timeout:120000});return;}
 for(const prefix of (['cc','codex'].includes(engine)?['/opt/homebrew','/usr/local']:[])){
  const formula=engine==='cc'?'claude-code':'codex';
  const cask=target.startsWith(path.join(prefix,'Caskroom',formula)+path.sep),cellar=target.startsWith(path.join(prefix,'Cellar',formula)+path.sep);
  if(cask || cellar){await execute(path.join(prefix,'bin/brew'),['uninstall',cask?'--cask':'--formula',formula],{timeout:120000});return;}
 }
 throw new Error('无法识别此 CLI 的安装方式，请使用原安装工具卸载后重新检测');
}
