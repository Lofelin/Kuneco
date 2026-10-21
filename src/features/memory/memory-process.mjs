// Direct tasks have a private /tmp. Prepare the extraction directory inside the
// same worker that launches the runtime; a directory in the proxy worker is absent.
const bootstrap=`const fs=require('node:fs'),{spawn}=require('node:child_process');
const [directory,command,...args]=process.argv.slice(1);
const cleanup=()=>{try{fs.rmdirSync(directory);}catch{}};
try{fs.mkdirSync(directory,{recursive:true,mode:0o700});const child=spawn(command,args,{cwd:directory,stdio:'inherit'});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('error',()=>{cleanup();process.exit(1);});child.on('close',code=>{cleanup();process.exit(code??1);});
}catch{cleanup();process.exit(1);}`;
export function memoryDirectorySpawner(spawnProcess,directory){
 if(!/^\/tmp\/kuneco-memory-[a-zA-Z0-9-]+$/.test(directory))throw Error('记忆提取临时目录无效');
 return ({command,args=[],...options})=>spawnProcess({...options,command:'node',args:['-e',bootstrap,directory,command,...args]});
}
