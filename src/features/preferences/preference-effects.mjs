import {normalizePreferences} from '../../shared/preferences.mjs';
import {configureDateDisplay,formatDisplayDate,formatCompactTime} from '../../shared/date-format.mjs';
export function applyPreferences(value,document=globalThis.document){
 const preferences=normalizePreferences(value),root=document.documentElement;
 root.style.setProperty('--chat-font-size',preferences.chatFontSize+'px');root.style.setProperty('--code-font-size',preferences.codeFontSize+'px');
 root.dataset.reducedMotion=String(preferences.motion==='reduce');
 configureDateDisplay(preferences);
 if(preferences.motion==='reduce')for(const animation of document.getAnimations()){try{animation.finish();}catch{animation.cancel();}}
 document.dispatchEvent(new CustomEvent('preferences-changed',{detail:preferences}));
 return preferences;
}
export function refreshTimeElements(document=globalThis.document){
 for(const time of document.querySelectorAll('time[datetime]')){
  time.textContent=time.dataset.timeKind==='compact'?formatCompactTime(time.dateTime):formatDisplayDate(time.dateTime,document.documentElement.lang,time.dataset.timeKind||'datetime');
  time.title=formatDisplayDate(time.dateTime,document.documentElement.lang,'datetime',{timeDisplay:'absolute'});
 }
}
