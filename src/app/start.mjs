import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import {ensureAccountBackend} from './start-backend.mjs';
import {desktopExecutable} from './desktop-launcher.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url));
try{
 const backend=await ensureAccountBackend({root});
 console.log(backend.external?'使用远程账号服务':backend.reused?'账号后端已运行，复用现有服务':'账号后端已就绪');
 const args=['.',...process.argv.slice(2),...(process.platform==='darwin'?['-AppleLanguages','(en-US)']:[])];
 const executable=await desktopExecutable({root,electron});
 const child=spawn(executable,args,{cwd:root,stdio:'inherit'});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
 child.once('error',error=>{console.error(error.message);process.exitCode=1;});
 child.once('exit',code=>{process.exitCode=code??0;});
}catch(error){console.error('Kuneco启动失败：'+error.message);process.exitCode=1;}
