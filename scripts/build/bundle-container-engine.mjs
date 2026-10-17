import {execFileSync} from 'node:child_process';
import {cp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
// Build-time tool: release packages ship these files; end users need no Homebrew.
if(process.platform!=='darwin')throw new Error('当前引擎包仅支持 macOS');
const prefix=name=>execFileSync('/opt/homebrew/bin/brew',['--prefix',name],{encoding:'utf8'}).trim();
const destination=path.resolve('vendor/container-engine');await mkdir(destination,{recursive:true});
for(const directory of ['bin','libexec','share','etc'])await cp(path.join(prefix('lima'),directory),path.join(destination,directory),{recursive:true,dereference:true});
for(const name of ['docker','colima'])await cp(path.join(prefix(name),'bin',name),path.join(destination,'bin',name),{dereference:true});
await writeFile(path.join(destination,'manifest.json'),JSON.stringify({platform:process.platform,architecture:process.arch,createdAt:new Date().toISOString(),source:'Homebrew docker/colima/lima official formulae'},null,2));
console.log('容器引擎组件已准备：'+destination);
