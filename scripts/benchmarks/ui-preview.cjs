const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');

/** Run an isolated component gallery. Never attach the application's preload or profile. */
async function runPreview(){
 const temporaryProfile=await fs.mkdtemp(path.join(os.tmpdir(),'kuneco-ui-preview-'));
 app.setPath('userData',temporaryProfile);
 await app.whenReady();
 const root=path.resolve(__dirname,'../..');
 const isolatedSession=session.fromPartition('ui-preview-'+Date.now());
 isolatedSession.webRequest.onBeforeRequest((details,callback)=>{
  const local=/^(file:|data:|devtools:)/.test(details.url);
  callback({cancel:!local});
 });
 isolatedSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 isolatedSession.setPermissionCheckHandler(()=>false);
 const win=new BrowserWindow({title:'Kuneco · 全局组件验收',show:true,width:1280,height:1000,minWidth:360,minHeight:600,webPreferences:{session:isolatedSession,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',event=>event.preventDefault());
 app.on('window-all-closed',()=>app.quit());
 app.on('will-quit',()=>{require('node:fs').rmSync(temporaryProfile,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 try{
  await win.loadFile(path.join(root,'src/shared/ui/preview/index.html'));
 }catch(error){win.destroy();app.exit(1);throw error;}
 return win;
}
module.exports={runPreview};
if(process.argv[1] && path.resolve(process.argv[1])===__filename){
 if(process.argv.includes('--verify')){console.error('自动组件验收已迁移至 npm run test:desktop；此入口仅供手工预览。');app.exit(1);}
 else runPreview().catch(error=>{console.error(error);app.exit(1);});
}
