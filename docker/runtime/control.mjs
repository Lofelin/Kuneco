import http from 'node:http';
let input='';for await(const chunk of process.stdin)input+=chunk;
const req=http.request('http://127.0.0.1:9091/',{method:'POST',headers:{'content-type':'application/json'}},res=>{res.pipe(process.stdout);res.on('end',()=>{if(res.statusCode!==200)process.exitCode=1;});});
req.on('error',()=>{process.stderr.write('容器代理服务不可用');process.exitCode=1;});req.end(input);
