let positioning;const loadPositioning=()=>positioning??=import('../../vendor/dropdown-positioning.js');
/** Extend the pinned Web Awesome positioning hook while retaining its lifecycle and keyboard handling. */
export function preferLeftSubmenus(menu){
 const install=()=>{if(menu.dataset.submenuSide==='left'||typeof menu.positionSubmenu!=='function')return;const original=menu.positionSubmenu.bind(menu);menu.dataset.submenuSide='left';
  menu.positionSubmenu=item=>{const panel=item.submenuElement;if(!panel)return original(item);
   return loadPositioning().then(({computePosition,offset,shift})=>computePosition(item,panel,{strategy:'fixed',placement:'left-start',middleware:[offset({mainAxis:0,crossAxis:-4}),shift({padding:8,crossAxis:true})]})).then(({x,y,placement})=>{if(!item.submenuOpen)return;panel.dataset.placement=placement;Object.assign(panel.style,{position:'fixed',left:x+'px',top:y+'px'});});
  };
 };install();menu.addEventListener('wa-show',install);menu.addEventListener('submenu-opening',event=>{const item=event.detail.item;menu.ownerDocument.defaultView.requestAnimationFrame(()=>{if(item.submenuOpen)menu.positionSubmenu(item);});});
}
