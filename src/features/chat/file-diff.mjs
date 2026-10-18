import {cachedChangeRows} from './diff-row-cache.mjs';
export function diffLines(before,after){
 const lines=value=>value.match(/[^\n]*\n|[^\n]+$/g)||[];
 const a=lines(before),b=lines(after);let start=0,end=0;
 while(start<a.length&&start<b.length&&a[start]===b[start])start++;
 while(end<a.length-start&&end<b.length-start&&a[a.length-end-1]===b[b.length-end-1])end++;
 const rows=a.slice(0,start).map(text=>({type:'context',text}));const aa=a.slice(start,a.length-end),bb=b.slice(start,b.length-end);
 if(aa.length*bb.length<=1000000){const dp=Array.from({length:aa.length+1},()=>new Uint32Array(bb.length+1));for(let i=aa.length-1;i>=0;i--)for(let j=bb.length-1;j>=0;j--)dp[i][j]=aa[i]===bb[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);let i=0,j=0;while(i<aa.length||j<bb.length){if(i<aa.length&&j<bb.length&&aa[i]===bb[j]){rows.push({type:'context',text:aa[i++]});j++;}else if(i<aa.length&&(j===bb.length||dp[i+1][j]>=dp[i][j+1]))rows.push({type:'deletion',text:aa[i++]});else rows.push({type:'addition',text:bb[j++]});}}
 else {rows.push(...aa.map(text=>({type:'deletion',text})),...bb.map(text=>({type:'addition',text})));}
 rows.push(...a.slice(a.length-end).map(text=>({type:'context',text})));let old=1,next=1;return rows.map(row=>({...row,text:row.text.replace(/\n$/,''),old:row.type==='addition'?null:old++,next:row.type==='deletion'?null:next++}));
}
export function parseUnifiedDiff(diff){let old=0,next=0,active=false;const rows=[];for(const line of diff.split('\n')){const h=/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);if(h){old=+h[1];next=+h[2];active=true;rows.push({type:'hunk',text:line});continue;}if(!active||line.startsWith('\\')||![' ','+','-'].includes(line[0]))continue;const type=line[0]==='+'?'addition':line[0]==='-'?'deletion':'context';rows.push({type,text:line.slice(1),old:type==='addition'?null:old++,next:type==='deletion'?null:next++});}return rows;}
export function changeRows(change){return cachedChangeRows(change,snapshot=>snapshot.before!==null?diffLines(snapshot.before,snapshot.after):parseUnifiedDiff(snapshot.diff));}
export function renderFileDiffs(panel,activity){
 for(const change of activity.changes||[]){
  const details=document.createElement('details');details.className='activity-file-diff';const summary=document.createElement('summary');summary.textContent='文件差异 · '+change.path;details.append(summary);const id=change.path;
  details.open=activity.diffExpanded?.[id]??false;summary.addEventListener('click',()=>{(activity.diffExpanded||={})[id]=!details.open;details.dispatchEvent(new CustomEvent('reasoning-toggle',{bubbles:true}));});
  if(change.unavailable){const p=document.createElement('p');p.textContent='差异不可用：'+change.unavailable;details.append(p);panel.append(details);continue;}
  let rows,rendered=false;
  const modes=document.createElement('wa-radio-group');modes.className='diff-modes app-segmented';modes.setAttribute('aria-label','差异视图');modes.orientation='horizontal';modes.size='s';const content=document.createElement('div');let mode=activity.diffMode||'unified';
  const render=()=>{rows??=changeRows(change);rendered=true;content.replaceChildren();content.className='file-diff-content '+mode;modes.value=mode;
   if(!rows.length){const p=document.createElement('p');p.textContent='没有文本行差异';content.append(p);return;}
   const create=side=>{const pre=document.createElement('pre');pre.setAttribute('aria-label',side==='old'?'修改前':side==='new'?'修改后':'统一差异');for(const row of rows){const line=document.createElement('span');line.className='diff-line '+row.type;const visible=side==='old'?row.type!=='addition':side==='new'?row.type!=='deletion':true;const number=side==='old'?row.old:row.next;line.textContent=visible?(side?String(number??'').padStart(4)+'  ':String(row.old??'').padStart(4)+' '+String(row.next??'').padStart(4)+' '+({addition:'+',deletion:'-',context:' ',hunk:' '}[row.type]))+row.text:' ';pre.append(line);}return pre;};if(mode==='split')content.append(create('old'),create('new'));else content.append(create());};
  for(const [value,label] of [['unified','统一'],['split','左右对照']]){const option=document.createElement('wa-radio');option.appearance='button';option.value=value;option.textContent=label;modes.append(option);}modes.value=mode;modes.addEventListener('change',()=>{activity.diffMode=mode=modes.value;render();details.dispatchEvent(new CustomEvent('reasoning-toggle',{bubbles:true}));});details.append(modes,content);
  // The summary click precedes the native toggle. Build synchronously so the
  // first expanded frame (including keyboard activation) already has content.
  summary.addEventListener('click',()=>{if(!details.open&&!rendered)render();});
  details.addEventListener('toggle',()=>{if(details.open&&!rendered)render();});
  if(details.open)render();panel.append(details);
 }
}
