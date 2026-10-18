// Explicitly target an owned running worker; only creates/removes its unique test file.
const {app,BrowserWindow,session}=require('electron');
const {mkdtemp,rm,readFile}=require('node:fs/promises');
const path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
app.on('window-all-closed',()=>{});
(async()=>{
 const worker=process.env.KUNECO_DOWNLOAD_TEST_WORKER;if(!worker?.endsWith('-worker'))throw Error('Set KUNECO_DOWNLOAD_TEST_WORKER to an owned running worker');
 const directory=await mkdtemp(path.join(os.tmpdir(),'kuneco-container-download-'));app.setPath('userData',directory);await app.whenReady();
 const {DockerEnvironments}=await import('../../src/features/environments/docker-environments.mjs');
 const {createContainerDownloads}=await import('../../src/features/browser/browser-downloads.mjs');
 const {createBrowserFeatures}=await import('../../src/features/browser/browser-features.mjs');
 const docker=new DockerEnvironments({sourceRoot:path.resolve(__dirname,'../..')});docker.get=async()=>({prefix:worker.slice(0,-7),item:{}});
 const adapter=createContainerDownloads({docker,directory:path.join(directory,'export')});const scope={owner:'synthetic-download-test',environmentId:'synthetic-environment'};
 const storage=session.fromPartition('test-'+Date.now());let file,win,server;
 try{
  server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="kuneco-download-test.txt"'});res.end('Kuneco synthetic container download\n');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  win=new BrowserWindow({show:false,webPreferences:{session:storage}});const wc=win.webContents,tab={id:'test',wc};
  const features=createBrowserFeatures({app,containerDownloads:adapter,safeStorage:{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()},dialog:{},shell:{},getWindow:()=>win,getScope:()=>scope,getTabs:()=>[tab],getActive:()=>tab,valid:()=>true,emit(){}});
  await features.configured(storage,scope);await features.operate('settings',{askDownload:false});
  const base=(await features.operate('get')).downloadDirectory;assert.equal(base,'/home/node/Download');
  wc.downloadURL('http://127.0.0.1:'+server.address().port+'/file');let record;
  for(let i=0;i<300;i++){record=(await features.library.get(scope)).downloads[0];if(record?.state==='completed')break;if(record?.error)throw Error(record.error);await new Promise(r=>setTimeout(r,100));}
  assert.equal(record?.state,'completed');file=record.path;assert.equal(path.posix.dirname(file),base);assert.equal(record.container,true);
  const actual=await docker.exec(scope.owner,scope.environmentId,['node','-e','process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))',file]);assert.equal(actual,'Kuneco synthetic container download');
  const exported=await adapter.export(scope,file,record.id);assert.equal(await readFile(exported,'utf8'),'Kuneco synthetic container download\n');
  await assert.rejects(adapter.save(scope,exported,file));
  console.log('PASS real Electron download -> current worker /home/node/Download; contents, export, overwrite protection');
 }finally{if(file)await docker.exec(scope.owner,scope.environmentId,['node','-e','require("fs").unlinkSync(process.argv[1])',file]);win?.destroy();server?.close();await rm(directory,{recursive:true,force:true});}
})().then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)});
