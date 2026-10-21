import {consoleShortcutDefaults,normalizeConsoleShortcuts} from './console-shortcuts.mjs';
export const consoleFonts=Object.freeze({default:'Menlo, Monaco, Consolas, monospace',menlo:'Menlo, monospace',monaco:'Monaco, monospace',consolas:'Consolas, monospace',system:'monospace'});
export const consoleDefaults=Object.freeze({consoleTheme:'dark',consoleFont:'default',consoleFontSize:13,consoleLineHeight:1,consoleCursor:'block',consoleCursorBlink:true,consoleScrollback:5000,consoleScrollOnInput:true,consoleAutoConnect:true,consoleConfirmPaste:true,consoleShortcuts:consoleShortcutDefaults,consoleDirectories:Object.freeze({})});
export const consoleChoices=Object.freeze({consoleTheme:['system','light','dark'],consoleFont:Object.keys(consoleFonts),consoleLineHeight:[1,1.2,1.4],consoleCursor:['block','bar','underline'],consoleScrollback:[1000,5000,10000,20000]});
export function validConsoleDirectory(value){return typeof value==='string'&&value.length<=4096&&(value===''||value.startsWith('/'))&&!/[\x00-\x1f\x7f]/.test(value);}
export function normalizeConsolePreferences(value){
 const out={...consoleDefaults,consoleShortcuts:normalizeConsoleShortcuts(value.consoleShortcuts),consoleDirectories:{}};
 for(const [key,choices] of Object.entries(consoleChoices))if(choices.includes(value[key]))out[key]=value[key];
 for(const key of ['consoleCursorBlink','consoleScrollOnInput','consoleAutoConnect','consoleConfirmPaste'])if(typeof value[key]==='boolean')out[key]=value[key];
 if(Number.isInteger(value.consoleFontSize)&&value.consoleFontSize>=10&&value.consoleFontSize<=24)out.consoleFontSize=value.consoleFontSize;
 if(value.consoleDirectories&&typeof value.consoleDirectories==='object'&&!Array.isArray(value.consoleDirectories))for(const [key,path] of Object.entries(value.consoleDirectories))if(key!=='__proto__'&&validConsoleDirectory(path))out.consoleDirectories[key]=path;
 return out;
}
export function consoleOptions(value,dark=false){
 const p=normalizeConsolePreferences(value),isDark=p.consoleTheme==='dark'||p.consoleTheme==='system'&&dark;
 return {fontFamily:consoleFonts[p.consoleFont],fontSize:p.consoleFontSize,lineHeight:p.consoleLineHeight,cursorStyle:p.consoleCursor,cursorBlink:p.consoleCursorBlink,scrollback:p.consoleScrollback,scrollOnUserInput:p.consoleScrollOnInput,theme:isDark?{background:'#151820',foreground:'#e5e8f0',cursor:'#e5e8f0',selectionBackground:'#56618180'}:{background:'#ffffff',foreground:'#20242c',cursor:'#20242c',selectionBackground:'#b7c8e080'}};
}
