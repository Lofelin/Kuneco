// SHA-256 digests pinned from the official MetaCubeX/mihomo v1.19.32 GitHub release.
import {mkdir,writeFile,chmod,rename,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const version='1.19.32';
const releases={
 darwin_arm64:['darwin-arm64','3312a6780652c622890fd4357c6a853bbf865464fd047ac7b7f52dab8de18652'],
 darwin_amd64:['darwin-amd64-compatible','18b382df77bded2ad0fb3db27db5636cb15b20729d5ba995a357eeb9b46bf507'],
 linux_arm64:['linux-arm64','9dd862e28b46ff7d775f169cceebc28deccaa0a9e804237d421cd2571e0caba0'],
 linux_amd64:['linux-amd64-compatible','ba3ce607747a07f948fc35780e108a4a7c7f552a38b9bd4d115f313ebcb89c20']
};
const args=process.argv.slice(2);let platform=process.platform,arch=process.arch==='x64'?'amd64':process.arch;const targets=[];
for(let i=0;i<args.length;i++){
 if(args[i]==='--platform')platform=args[++i];
 else if(args[i]==='--arch')arch=args[++i]==='x64'?'amd64':args[i];
 else if(args[i].startsWith('--'))throw new Error('Unknown Mihomo installer option');
 else targets.push(args[i]);
}
if(!targets.length)targets.push(`${platform}_${arch}`);
for(const target of targets){
 const release=releases[target];if(!release)throw new Error('Unsupported Mihomo platform: '+target);
 const [asset,hash]=release,name=`mihomo-${asset}-v${version}.gz`;
 const response=await fetch(`https://github.com/MetaCubeX/mihomo/releases/download/v${version}/${name}`,{signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw new Error('Mihomo archive download failed');
 const bytes=Buffer.from(await response.arrayBuffer());
 if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('Mihomo checksum mismatch');
 const destination=new URL(`../../vendor/mihomo/${target}/`,import.meta.url);await mkdir(destination,{recursive:true});
 const temporary=new URL(`mihomo.install-${process.pid}`,destination),binary=new URL('mihomo',destination);
 try{await writeFile(temporary,gunzipSync(bytes),{mode:0o755});await chmod(temporary,0o755);await rename(temporary,binary);}
 finally{await rm(temporary,{force:true});}
 console.log(`Installed verified Mihomo ${version}: ${target}`);
}
