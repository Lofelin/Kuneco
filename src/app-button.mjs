import WaButton from '@awesome.me/webawesome/dist/components/button/button.js';
import {css} from 'lit';
/** All business actions share Web Awesome form, loading and keyboard behavior. */
export class AppButton extends WaButton {
 static styles=[...WaButton.styles,css`
  :host{--button-icon-gap:6px;--button-padding-inline:6px}
  .button{column-gap:0!important;padding-inline:var(--button-padding-inline)}
  :host(:not([layout=custom]):not([icon-only]):not(.icon-button):not(.nav):not(.session-row):not(.account-trigger):not(.content-tab-select):not(.environment-detail-icon-button):not(.preview-round)) .button{padding-inline:var(--button-padding-inline)!important}
  slot[name=start]::slotted(*){margin-inline:0 var(--button-icon-gap)!important}
  slot[name=end]::slotted(*){margin-inline:var(--button-icon-gap) 0!important}
  :host([appearance=plain]) .button,:host(.transparent-action) .button,:host(.text-button) .button{background:transparent!important;border-color:transparent!important;box-shadow:none!important}
  .button:focus-visible{outline:2px solid var(--field-focus-ring,color-mix(in srgb,var(--blue) 16%,transparent));outline-offset:2px}
  :host([layout=custom]) .button{display:inherit;align-items:inherit;justify-content:inherit;gap:inherit!important;width:100%;height:100%;min-height:0;padding:0!important;border:0;background:transparent;color:inherit;font:inherit;white-space:inherit}
  :host([layout=custom]) .label{display:contents}
  :host(.retry-action) .button{color:var(--ink)!important;background:var(--surface)!important;border-color:var(--line)!important;white-space:nowrap;filter:none!important}
  :host(.retry-action:not([disabled]):not([loading])) .button:is(:hover,:active){color:var(--ink)!important;background:var(--soft)!important;border-color:var(--line)!important;filter:none!important}
  :host(.retry-action) slot::slotted(wa-icon){color:inherit}
  :host([variant=danger]) .button{background:var(--delete-background)!important;color:var(--delete-foreground)!important;border-color:transparent!important;box-shadow:none!important;filter:none!important}
  :host([variant=danger]:not([disabled]):not([loading])) .button:is(:hover,:active){background:var(--delete-hover-background)!important;color:var(--delete-hover-foreground)!important}
  :host([variant=danger]) slot::slotted(wa-icon){color:inherit!important}

 `];
 constructor(){super();this.size='s';}
}
customElements.define('app-button',AppButton);
