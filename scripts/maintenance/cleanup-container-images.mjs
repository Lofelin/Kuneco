import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {inspectImageCleanup,applyImageCleanup} from '../../src/features/environments/image-maintenance.mjs';
const args=process.argv.slice(2);
const usage='Usage: node scripts/maintenance/cleanup-container-images.mjs --context NAME [--preview FILE | --apply FILE]';
if(args.length!==2 && args.length!==4 || args[0]!=='--context' || !args[1] || args.length===4&&!['--preview','--apply'].includes(args[2]))throw new Error(usage);
const run=promisify(execFile);
const command=async argv=>(await run('docker',['--context',args[1],...argv],{timeout:60000,maxBuffer:16*1024*1024})).stdout;
if(args[2]==='--apply') {
 const preview=JSON.parse(await readFile(args[3],'utf8'));
 if(preview.context!==args[1])throw new Error('Docker context does not match preview');
 console.log(JSON.stringify(await applyImageCleanup(command,preview),null,2));
} else {
 const preview={context:args[1],...await inspectImageCleanup(command)};
 if(args[2]==='--preview')await writeFile(args[3],JSON.stringify(preview,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(preview,null,2));
}
