export function validateSchedule(s){
 if(!s || !['fixed','interval'].includes(s.mode))throw new Error('请选择定点或按间隔');
 try{new Intl.DateTimeFormat('en',{timeZone:s.timeZone}).format();}catch{throw new Error('无效时区');}
 const time=v=>typeof v==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
 if(!Array.isArray(s.days)||!s.days.length||s.days.some(d=>!Number.isInteger(d)||d<0||d>6))throw new Error('请至少选择一天');
 if(s.mode==='fixed'&&!time(s.time))throw new Error('请选择执行时间');
 if(s.mode==='interval'&&(!time(s.start)||!time(s.end)||s.start>s.end||!Number.isInteger(s.minutes)||s.minutes<5||s.minutes>1440))throw new Error('间隔至少5分钟，结束时间不能早于开始时间');
 return {mode:s.mode,time:s.time || '09:00',start:s.start || '09:00',end:s.end || '18:00',minutes:s.minutes || 60,days:[...new Set(s.days)],timeZone:s.timeZone};
}
export function nextRuns(schedule,after=Date.now(),count=3){
 const s=validateSchedule(schedule),out=[];const formatter=new Intl.DateTimeFormat('en-US',{timeZone:s.timeZone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const dateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:s.timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
 const dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];const minute=v=>Number(v.slice(0,2))*60+Number(v.slice(3));const seen=new Set();
 for(let t=Math.floor(after/60000)*60000+60000;t<=after+15*86400000 && out.length<count;t+=60000){
  const p=Object.fromEntries(formatter.formatToParts(t).map(v=>[v.type,v.value]));if(!s.days.includes(dayNames.indexOf(p.weekday)))continue;const m=Number(p.hour)*60+Number(p.minute);
  const matches=s.mode==='fixed'?m===minute(s.time):m>=minute(s.start)&&m<=minute(s.end)&&(m-minute(s.start))%s.minutes===0;
  // During a fall-back hour, execute once for each local wall-clock slot.
  if(matches){const key=dateFormatter.format(t)+':'+m;if(!seen.has(key)){out.push(t);seen.add(key);}}
 }return out;
}
