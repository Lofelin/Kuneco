import {watch} from 'node:fs';
import {readFile,appendFile} from 'node:fs/promises';
import path from 'node:path';
// Native application boundary only: use the same calls as window chrome and Quit.
// No renderer bridge, running-task state, quit guard or shutdown code is replaced.
export function installNativeAppFixture(app,mainWindow,directory){
 let lastId;
 const watcher=watch(directory,(_event,file)=>{if(String(file)!=='native-app-command.json')return;void dispatch();});
 async function dispatch(){
  let command;try{command=JSON.parse(await readFile(path.join(directory,'native-app-command.json'),'utf8'));}catch{return;}
  if(!command.id||command.id===lastId)return;
  lastId=command.id;
  if(!['window-close','app-quit'].includes(command.action))throw Error('Unknown native test action');
  await appendFile(path.join(directory,'native-app-events.jsonl'),JSON.stringify(command)+'\n');
  if(command.action==='window-close')mainWindow().close();else app.quit();
 }
 app.once('will-quit',()=>watcher.close());
 return ()=>watcher.close();
}
