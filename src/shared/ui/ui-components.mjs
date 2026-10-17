import './app-table.mjs';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/dropdown/dropdown.js';
import '@awesome.me/webawesome/dist/components/dropdown-item/dropdown-item.js';
import './app-button.mjs';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/number-input/number-input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import '@awesome.me/webawesome/dist/components/switch/switch.js';
import '@awesome.me/webawesome/dist/components/radio/radio.js';
import '@awesome.me/webawesome/dist/components/radio-group/radio-group.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import './app-dialog.mjs';
import '@awesome.me/webawesome/dist/components/card/card.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/avatar/avatar.js';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import '@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js';
import '@awesome.me/webawesome/dist/components/toast/toast.js';
import '@awesome.me/webawesome/dist/components/toast-item/toast-item.js';
import '@awesome.me/webawesome/dist/components/tooltip/tooltip.js';
import '@awesome.me/webawesome/dist/translations/zh-cn.js';
// Definitions and first renders complete before application logic accesses values.
await Promise.all([...document.querySelectorAll('*')].filter(el=>(el.localName.startsWith('wa-') || el.localName==='app-dialog' || el.localName==='app-button')).map(el=>el.updateComplete));
export function setUITheme(dark){ document.body.classList.toggle('wa-dark',dark);document.body.classList.toggle('wa-light',!dark); }
export function createUI(tag){const element=document.createElement(tag);if(tag==='app-button')element.size='s';return element;}

export function createIcon(name){const icon=document.createElement('wa-icon');icon.src=`assets/icons/${name==='claude-code'?'claude-brand':name}.svg`;if(name==='claude-code'||name==='codex')icon.classList.add('brand-icon',`brand-${name}`);icon.setAttribute('aria-hidden','true');return icon;}
