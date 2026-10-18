import {diffLines,parseUnifiedDiff} from './file-diff.mjs';

function exactSnapshotBudget(before,after){
 const lines=s=>s.match(/[^\n]*\n|[^\n]+$/g)||[];const a=lines(before),b=lines(after);let start=0,end=0;
 while(start<a.length&&start<b.length&&a[start]===b[start])start++;
 while(end<a.length-start&&end<b.length-start&&a[a.length-end-1]===b[b.length-end-1])end++;
 return (a.length-start-end)*(b.length-start-end)<=1000000;
}
function completePatch(diff){
 let expected=null,old=0,next=0,found=false;
 const complete=()=>!expected||(old===expected[0]&&next===expected[1]);
 for(const line of diff.split('\n')){const h=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if(h){if(!complete())return false;expected=[Number(h[2]??1),Number(h[4]??1)];old=0;next=0;found=true;continue;}
  if(!expected||line.startsWith('\\'))continue;
  if(line.startsWith(' ')){old++;next++;}else if(line.startsWith('-'))old++;else if(line.startsWith('+'))next++;
 }
 return found&&complete();
}
// Only receipts bearing the server-assigned execution identity belong to this turn.
// Never infer ownership from timestamps, workspace Git status, or old chat messages.
export function summarizeTurnChanges(artifacts,turn,scope){
 if(!turn?.id)return null;
 if(scope&&['owner','environmentId','chatId'].some(key=>turn[key]!==scope[key]))return null;
 const groups=new Map();
 for(const entry of artifacts||[]){if(entry.turnId!==turn.id)continue;const list=groups.get(entry.path)||[];list.push(entry);groups.set(entry.path,list);}
 const files=[];
 for(const [path,entries] of groups){
  const first=entries[0],last=entries.at(-1);let change={path},reason=entries.find(e=>e.unavailable)?.unavailable;
  const snapshots=entries.every(e=>typeof e.before==='string'&&typeof e.after==='string');
  if(!reason&&snapshots){if(entries.some((e,i)=>i>0&&entries[i-1].after!==e.before))reason='前后快照不连续，无法确认本轮净差异';else if(!exactSnapshotBudget(first.before,last.after))reason='文件差异超过精确统计范围';else change={path,before:first.before,after:last.after,...(typeof first.beforeExists==='boolean'?{beforeExists:first.beforeExists}:{}),...(typeof last.afterExists==='boolean'?{afterExists:last.afterExists}:{})};}
  else if(!reason&&entries.length===1&&typeof first.diff==='string'&&completePatch(first.diff))change={path,diff:first.diff};
  else if(!reason)reason=entries.length>1?'多次修改缺少连续快照':'运行时未提供文本差异';
  let added=null,removed=null;
  if(!reason){const rows=snapshots?diffLines(change.before,change.after):parseUnifiedDiff(change.diff);added=rows.filter(r=>r.type==='addition').length;removed=rows.filter(r=>r.type==='deletion').length;}
  else change.unavailable=reason;
  files.push({path,added,removed,change,artifactIds:entries.map(e=>e.id)});
 }
 const known=files.every(f=>f.added!==null);return {id:turn.id,files,added:known?files.reduce((n,f)=>n+f.added,0):null,removed:known?files.reduce((n,f)=>n+f.removed,0):null};
}

// The server supplies execution roots and receipts; clients cannot invent an undo plan.
export function turnUndoAvailability(turn,metadata){
 if(metadata?.revertedAt)return {available:false,reason:'本轮变更已撤销',revertedAt:metadata.revertedAt,backups:metadata.undoBackups};
 if(metadata?.undoFailure)return {available:false,reason:metadata.undoFailure};
 if(!metadata?.project)return {available:false,reason:'此记录未保存执行目录，无法安全撤销'};
 if(!turn?.files.length)return {available:false,reason:'本轮没有文件变更'};
 if(turn.files.some(file=>file.change?.unavailable||typeof file.change?.before!=='string'||typeof file.change?.after!=='string'||typeof file.change?.beforeExists!=='boolean'||typeof file.change?.afterExists!=='boolean'))return {available:false,reason:'运行时未提供完整前后快照及文件存在性，无法安全撤销'};
 if(turn.files.every(file=>file.change.beforeExists===file.change.afterExists&&file.change.before===file.change.after))return {available:false,reason:'本轮文件已回到修改前状态'};
 return {available:true,reason:'撤销前核对文件内容，并保留恢复备份'};
}
