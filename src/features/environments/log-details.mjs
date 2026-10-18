export function logDetails(message){
 try{const value=JSON.parse(message);if(value&&typeof value==='object'&&!Array.isArray(value))return Object.entries(value).map(([key,value])=>[key,typeof value==='object'?JSON.stringify(value,null,2):String(value)]);}catch{}
 return [...message.matchAll(/\b([A-Za-z_][\w.-]*)=("[^"]*"|'[^']*'|[^\s]+)/g)].map(([,key,value])=>[key,value.replace(/^(["'])(.*)\1$/,'$2')]);
}
export function renderLogEntry(doc,entry,{id,expanded,onToggle}){
 const host=doc.createElement('div');host.className='environment-log-entry';
 const button=doc.createElement('app-button');button.setAttribute('layout','custom');button.className='environment-log-row';button.dataset.logId=id;button.setAttribute('aria-expanded',String(expanded));button.setAttribute('aria-label',`${entry.level} ${entry.message}`);
 const stamp=doc.createElement('span');stamp.className='muted';const date=new Date(entry.time);stamp.textContent=Number.isFinite(date.getTime())?date.toLocaleTimeString('zh-CN',{hour12:false})+'.'+String(date.getMilliseconds()).padStart(3,'0'):'—';stamp.title=entry.time;
 const level=doc.createElement('span');level.className='environment-log-level';level.dataset.levelName=entry.level;level.textContent=entry.level;
 const message=doc.createElement('span');message.className='environment-log-message';message.textContent=`[${entry.source}] ${entry.message}`;button.append(stamp,level,message);button.addEventListener('click',onToggle);button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();onToggle();}});host.append(button);
 if(expanded){const body=doc.createElement('div');body.className='environment-log-details';const full=doc.createElement('pre');full.textContent=entry.message;const fields=doc.createElement('dl');for(const [key,value] of [['Time',entry.time||'Not recorded'],['Source',entry.source],...logDetails(entry.message)]){const dt=doc.createElement('dt'),dd=doc.createElement('dd');dt.textContent=key;dd.textContent=value;fields.append(dt,dd);}body.append(full,fields);host.append(body);}
 return host;
}
