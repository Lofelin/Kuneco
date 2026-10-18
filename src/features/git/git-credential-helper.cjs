const fs=require('node:fs'),path=require('node:path');
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{input+=s;if(input.length>32768)process.exit(1);});
process.stdin.on('end',()=>{
 if(process.argv[2]!=='get')return;
 const values=Object.fromEntries(input.split('\n').filter(s=>s.includes('=')).map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
 if(values.protocol!=='https')return;
 try{const items=JSON.parse(fs.readFileSync(path.join(__dirname,'credentials.json'),'utf8')),item=items[values.host.toLowerCase()];if(item && (!values.username||values.username===item.username))process.stdout.write('username='+item.username+'\npassword='+item.token+'\n\n');}catch{}
});
