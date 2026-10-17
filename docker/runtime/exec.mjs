import {spawn} from 'node:child_process';
import {writeFileSync,unlinkSync} from 'node:fs';
const [id,command,...args]=process.argv.slice(2);
if(!/^[a-f0-9-]{36}$/.test(id))process.exit(1);
const child=spawn(command,args,{stdio:'inherit',detached:true});
writeFileSync('/tmp/dingtu-'+id,String(child.pid));
const terminate=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}};
process.on('SIGTERM',terminate);process.on('SIGINT',terminate);
child.on('error',()=>process.exit(1));child.on('exit',code=>{try{unlinkSync('/tmp/dingtu-'+id);}catch{}process.exit(code??1);});
