export function formatDisplayDate(value,locale='zh-CN',kind='datetime'){
 if(value===null || value===undefined || value==='')return '—';
 const date=new Date(value);if(Number.isNaN(date.getTime()))return '—';
 const language=locale==='en-US'?'en-US':'zh-CN';
 const options=kind==='time'?{timeStyle:'medium'}:kind==='date'?{dateStyle:'medium'}:{dateStyle:'medium',timeStyle:'medium'};
 if(language==='zh-CN' && kind!=='date')options.hourCycle='h23';
 // Date-only values represent a calendar day, not a UTC instant in the user's zone.
 if(kind==='date' && typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value))options.timeZone='UTC';
 return new Intl.DateTimeFormat(language,options).format(date);
}
