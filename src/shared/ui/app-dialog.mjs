import WaDialog from '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import {css} from 'lit';
/** Shared dialog shell. Pages supply label, body and footer; the shell owns geometry. */
export class AppDialog extends WaDialog{
 // Keep the application close API on the same cancellable lifecycle as header/Escape.
 async hide(){
  await this.updateComplete;
  if(this._hideRequest)return this._hideRequest;
  if(!this.open && !this.dialog.open)return;
  this._hideRequest=this.requestClose(this.dialog);
  try{await this._hideRequest;}finally{this._hideRequest=null;}
 }
 static styles=[...WaDialog.styles,css`
  :host{--backdrop-filter:var(--app-modal-backdrop-filter,blur(4px));--wa-color-overlay-modal:var(--app-modal-backdrop-color,rgb(160 165 175 / 18%))}
  .dialog::backdrop{background:var(--app-modal-backdrop-color,rgb(160 165 175 / 18%))!important;backdrop-filter:var(--app-modal-backdrop-filter,blur(4px))!important}
  .dialog{border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink)}
  .header{border-bottom:1px solid var(--line)!important;padding:10px var(--dialog-inset,16px)!important;min-height:44px;box-sizing:border-box;align-items:center;flex-shrink:0}
  .title{font-size:14px;font-weight:600;line-height:22px}
  .header-actions{align-self:center;align-items:center}
  .close{font-size:12px}
  .close::part(base){width:24px;height:24px;min-height:24px;padding:0}
  ::slotted([slot=header-actions]){--icon-hit-size:24px;font-size:12px}
  .body{padding:var(--dialog-inset,16px);min-height:0;overflow:auto}
  .footer{border-top:1px solid var(--line)!important;padding:10px var(--dialog-inset,16px)!important;background:var(--canvas,#f7f7f9)!important;align-items:center;flex-shrink:0}
  :host(#deepseekImagePreview) .header{padding:8px 22px 8px 100px!important;border-bottom:0!important;height:58px}
  :host(#deepseekImagePreview) .title{font-size:13px;font-weight:500}
  :host(#deepseekImagePreview) .close::part(base){width:30px;height:30px;border-radius:50%;background:var(--surface)}
  :host([custom-close]) .close{display:none}
  ::slotted([slot=label]){margin:0;font-size:inherit;font-weight:inherit;line-height:inherit}
  ::slotted([slot=footer]){margin:0!important}
 `];
}
customElements.define('app-dialog',AppDialog);
