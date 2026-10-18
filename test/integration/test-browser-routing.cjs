// Real Chromium sessions and loopback servers; never touches user settings or proxy.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http'),net=require('node:net'),assert=require('node:assert/strict'),vm=require('node:vm');
app.on('window-all-closed',()=>{});
setTimeout(()=>{console.error('Browser routing integration timed out');app.exit(1);},30000).unref();
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kuneco-route-'));app.setPath('userData',dir);await app.whenReady();
 const {createBrowserDirectTransport}=await import('../../src/features/browser/browser-direct.mjs');
 let hits=0,connects=0,healthy=true;
 const target=http.createServer((req,res)=>{hits++;res.end('<title>route-ok</title>route-ok');});await new Promise(r=>target.listen(0,'127.0.0.1',r));
 const gateway=http.createServer((req,res)=>{res.writeHead(502);res.end();});const sockets=new Set();gateway.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 gateway.on('connect',(req,client)=>{connects++;if(!healthy){client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');return;}const remote=net.connect(target.address().port,'127.0.0.1',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');client.pipe(remote);remote.pipe(client);});client.on('close',()=>remote.destroy());});await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const source=await fs.readFile(path.resolve(__dirname,'../../src/app/main.mjs'),'utf8');
 const config=source.slice(source.indexOf('async function browserProxyConfiguration(){')).split('\n}')[0]+'\n}';
 const readiness=source.match(/const browserNetworkReady=([^;]+);/)[0];
 const context=vm.createContext({createBrowserDirectTransport,publishTabs(){},gateway:{status:{state:'ready'},port:gateway.address().port,token:'test',address:'http://127.0.0.1:'+gateway.address().port}});
 vm.runInContext(`let browserMode='mixed',browserRoutingChanging=false,browserClearBusy=false,directBrowserTransport,directBrowserTransportPromise;${config}\n${readiness}`,context);
 let win;
 app.on('login',(event,wc,details,authInfo,callback)=>{event.preventDefault();callback('workspace',vm.runInContext('directBrowserTransport?.token || "test"',context));});
 try{
  for(const [index,mode,state,up,expected] of [[0,'mixed','ready',true,true],[1,'mixed','ready',false,true],[2,'mixed','blocked',false,true],[3,'proxy','ready',false,false],[4,'proxy','blocked',false,false]]){
   healthy=up;vm.runInContext(`browserMode=${JSON.stringify(mode)};gateway.status.state=${JSON.stringify(state)};directBrowserTransport?.closeConnections()`,context);
   const ses=session.fromPartition('route-'+index);await ses.setProxy(await vm.runInContext('browserProxyConfiguration()',context));
   ses.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!vm.runInContext('browserNetworkReady()',context)}));
   win=new BrowserWindow({show:false,webPreferences:{session:ses}});const before=hits;
   let loaded=false;try{await win.loadURL('http://127.0.0.1:'+target.address().port+'/case-'+index);loaded=await win.webContents.executeJavaScript('document.body.textContent')==='route-ok';}catch{}
   assert.equal(loaded,expected,`${mode}/${state}/${up}`);if(!expected)assert.equal(hits,before,'forced proxy reached direct target');
   if(mode==='mixed')assert.equal(vm.runInContext("directBrowserTransport.getRoute('127.0.0.1')",context),up?'proxy':'direct');
   console.log('PASS Chromium',mode,state,'proxy success='+up,'loaded='+loaded);
   win.destroy();win=null;await ses.closeAllConnections();
  }
 }finally{win?.destroy();await vm.runInContext('directBrowserTransport?.close()',context);for(const s of sockets)s.destroy();await new Promise(r=>gateway.close(r));await new Promise(r=>target.close(r));await fs.rm(dir,{recursive:true,force:true});}
})().then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)});
