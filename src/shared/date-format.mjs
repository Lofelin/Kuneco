let displayPreferences={hourCycle:'system',timeDisplay:'absolute'};
export function configureDateDisplay(value){displayPreferences={hourCycle:value.hourCycle,timeDisplay:value.timeDisplay};}
export function formatDisplayDate(value,locale='zh-CN',kind='datetime',overrides={}){
 if(value===null || value===undefined || value==='')return '—';
 const date=new Date(value);if(Number.isNaN(date.getTime()))return '—';
 const language=locale==='en-US'?'en-US':'zh-CN';
 const preferences={...displayPreferences,...overrides};
 if(kind!=='date' && preferences.timeDisplay==='relative'){
  const seconds=(date.getTime()-(preferences.now??Date.now()))/1000,absolute=Math.abs(seconds);
  const [unit,divisor]=absolute<60?['second',1]:absolute<3600?['minute',60]:absolute<86400?['hour',3600]:absolute<2592000?['day',86400]:absolute<31536000?['month',2592000]:['year',31536000];
  return new Intl.RelativeTimeFormat(language,{numeric:'auto'}).format(Math.round(seconds/divisor),unit);
 }
 const options=kind==='time'?{timeStyle:'medium'}:kind==='date'?{dateStyle:'medium'}:{dateStyle:'medium',timeStyle:'medium'};
 if(language==='zh-CN' && kind!=='date')options.hourCycle='h23';
 if(kind!=='date'&&preferences.hourCycle!=='system')options.hourCycle=preferences.hourCycle==='12'?'h12':'h23';
 if(preferences.timeZone)options.timeZone=preferences.timeZone;
 // Date-only values represent a calendar day, not a UTC instant in the user's zone.
 if(kind==='date' && typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value))options.timeZone='UTC';
 return new Intl.DateTimeFormat(language,options).format(date);
}
