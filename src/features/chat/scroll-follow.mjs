// One scroll state per conversation. Background streams never move the visible chat.
export function mountChatScroll(container,jumpButton){
 const states=new Map();let key=null,lastInput=-Infinity,scheduled=false,programmatic=false;
 const now=()=>performance.now();
 const state=()=>{if(!states.has(key))states.set(key,{pinned:true,top:0});return states.get(key);};
 const distance=()=>container.scrollHeight-container.scrollTop-container.clientHeight;
 const update=()=>{jumpButton.hidden=state().pinned||distance()<40;};
 const user=()=>{lastInput=now();state().pinned=false;update();};
 container.addEventListener('wheel',user,{passive:true});container.addEventListener('touchstart',user,{passive:true});
 container.addEventListener('pointerdown',user);
 container.addEventListener('keydown',e=>{if(['PageUp','PageDown','Home','End','ArrowUp','ArrowDown',' '].includes(e.key))user();});
 container.addEventListener('scroll',()=>{state().top=container.scrollTop;if(!programmatic&&now()-lastInput>150)state().pinned=distance()<40;update();},{passive:true});
 const bottom=()=>{programmatic=true;container.scrollTop=container.scrollHeight;state().top=container.scrollTop;requestAnimationFrame(()=>{programmatic=false;update();});};
 const jump=()=>{state().pinned=true;lastInput=-Infinity;bottom();};jumpButton.addEventListener('click',jump);
 return {
  save(){state().top=container.scrollTop;},
  restore(next){key=next;const current=state();requestAnimationFrame(()=>{if(key!==next)return;programmatic=true;if(current.pinned)bottom();else container.scrollTop=current.top;requestAnimationFrame(()=>{programmatic=false;update();});});},
  follow(target=container){if(target!==container)return;update();if(scheduled||!state().pinned||now()-lastInput<=150)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;if(state().pinned&&now()-lastInput>150)bottom();});},
  canFollow(target=container){return target===container&&state().pinned&&now()-lastInput>150;},jump,
  clear(){states.clear();key=null;lastInput=-Infinity;update();}
 };
}
