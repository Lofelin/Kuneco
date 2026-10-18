import './app-button.mjs';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
/** Click or drop one file. Native selection and validation belong to the caller. */
class AppFilePicker extends HTMLElement {
 constructor(){
  super();this._dragDepth=0;
  this.attachShadow({mode:'open'});
  const sheet=new CSSStyleSheet();sheet.replaceSync(`
   :host{display:block}
   app-button{display:flex;align-items:center;justify-content:center;width:100%;min-height:var(--file-picker-min-height,112px);box-sizing:border-box;border:1px dashed var(--line);border-radius:14px;background:var(--surface);color:var(--muted)}
   .file-content{display:flex;align-items:center;gap:16px;padding:var(--file-picker-padding,24px);min-width:0;max-width:100%;box-sizing:border-box;text-align:left}
   app-button:not([disabled]):hover,:host([dragging]) app-button{background:var(--hover);color:var(--ink)}
   app-button::part(base){width:100%;box-shadow:none}
   .upload-icon{display:flex;align-items:center;justify-content:center;width:48px;height:48px;flex:none;border-radius:14px;color:var(--muted)}
   .file-copy{display:flex;flex-direction:column;gap:4px;min-width:0}
   wa-icon{font-size:24px;flex:none}
   span{color:var(--ink);font-weight:500;font-size:14px;line-height:20px;overflow-wrap:anywhere;max-width:100%}
   small{font-size:12px;line-height:18px;color:var(--muted)}
  `);this.shadowRoot.adoptedStyleSheets=[sheet];
  this.shadowRoot.innerHTML=`<app-button appearance="plain" layout="custom" type="button" aria-label="点击选择文件或拖入文件"><div class="file-content"><div class="upload-icon"><wa-icon src="assets/icons/file-up.svg" aria-hidden="true"></wa-icon></div><div class="file-copy"><span aria-live="polite">点击或拖拽上传代理文件</span><small>支持 TXT、CSV，最大 1 MB</small></div></div></app-button>`;
  this.addEventListener('dragenter',event=>{event.preventDefault();if(!this.disabled){this._dragDepth++;this.setAttribute('dragging','');}});
  this.addEventListener('dragover',event=>{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect=this.disabled?'none':'copy';});
  this.addEventListener('dragleave',event=>{event.preventDefault();if(--this._dragDepth<=0)this.resetDrag();});
  this.addEventListener('drop',event=>{
   event.preventDefault();event.stopPropagation();this.resetDrag();if(this.disabled)return;
   this.dispatchEvent(new CustomEvent('files-selected',{detail:{files:[...(event.dataTransfer?.files||[])]},bubbles:true,composed:true}));
  });
 }
 resetDrag(){this._dragDepth=0;this.removeAttribute('dragging');}
 set value(value){this._value=value||'';this.shadowRoot.querySelector('span').textContent=this._value||'点击或拖拽上传代理文件';this.shadowRoot.querySelector('small').textContent=this._value?'点击或拖入文件可重新选择':'支持 TXT、CSV，最大 1 MB';}
 get value(){return this._value||'';}
 set disabled(value){this.shadowRoot.querySelector('app-button').disabled=Boolean(value);if(value)this.resetDrag();}
 get disabled(){return this.shadowRoot.querySelector('app-button').disabled;}
}
customElements.define('app-file-picker',AppFilePicker);
