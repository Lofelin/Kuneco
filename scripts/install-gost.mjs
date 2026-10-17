// Pinned official release archives; no installer scripts or unverified executables.
import {mkdir,writeFile,chmod,rm,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
const version='3.3.0';
const hashes={darwin_arm64:'f170226106844b50ab3435147f35d4300da773efca256b50cb2f8c7d3a151101',darwin_amd64:'9be5b30354bbe59b6b160af01c66b209c93335db29b272b67bd73feca4abe4ec',linux_arm64:'d03699e3f385d4ff5dad68046712adfcc7515325a064d2ab046e0bece30f8f8f',linux_amd64:'676fb7f78d267b6ae73df719c0c7f2b565dde7147da935cfafbc1e1da558b6d5'};
const targets=process.argv.slice(2);if(!targets.length)targets.push(process.platform+'_'+(process.arch==='x64'?'amd64':process.arch));
for(const target of targets){
 if(!hashes[target])throw new Error('Unsupported GOST platform: '+target);
 const name=`gost_${version}_${target}.tar.gz`,response=await fetch(`https://github.com/go-gost/gost/releases/download/v${version}/${name}`);
 if(!response.ok)throw new Error('GOST archive download failed');
 const bytes=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==hashes[target])throw new Error('GOST checksum mismatch');
 const temporary=await mkdtemp(path.join(tmpdir(),'kuneco-gost-install-'));
 try{
  const archive=path.join(temporary,name);await writeFile(archive,bytes);
  const destination=new URL(`../vendor/gost/${target}/`,import.meta.url);await mkdir(destination,{recursive:true});
  execFileSync('tar',['-xzf',archive,'-C',destination.pathname,'gost']);await chmod(new URL('gost',destination),0o755);
  console.log(`Installed verified GOST ${version}: ${target}`);
 }finally{await rm(temporary,{recursive:true,force:true});}
}
