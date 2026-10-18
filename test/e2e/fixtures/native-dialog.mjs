import {readFile,appendFile} from 'node:fs/promises';
import path from 'node:path';
// OS picker boundary only. The renderer, preload, IPC handler and file parser run unchanged.
export function installNativeDialogFixture(dialog,directory){
 dialog.showOpenDialog=async(...args)=>{
  const options=args.at(-1);let state;
  try{state=JSON.parse(await readFile(path.join(directory,'native-dialog-control.json'),'utf8'));}catch{throw Error('No native picker response was arranged by the desktop suite');}
  await appendFile(path.join(directory,'native-dialog-requests.jsonl'),JSON.stringify(options)+'\n');
  return structuredClone(state);
 };
}
