import {reducedMotion} from './motion.mjs';
// Reference: https://science.nasa.gov/resource/the-milky-way-galaxy/ (artist concept).
// Milky Way inspired star-density texture: central bar, clustered arms and dust lanes.
// Draw the texture once; only composite it while the creation screen is visible.
export function mountGalaxy(canvas){
 if(!canvas)return;
 const texture=document.createElement('canvas');texture.width=texture.height=1400;
 const g=texture.getContext('2d'),center=700;let seed=73921;
 const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
 const gaussian=()=>Math.sqrt(-2*Math.log(Math.max(random(),.00001)))*Math.cos(2*Math.PI*random());
 const cloud=(x,y,r,color)=>{const gradient=g.createRadialGradient(x,y,0,x,y,r);gradient.addColorStop(0,color);gradient.addColorStop(1,'transparent');g.fillStyle=gradient;g.fillRect(x-r,y-r,r*2,r*2);};
 // Warm old stars in the bulge, surrounded by a cooler diffuse disk.
 cloud(center,center,660,'rgba(107,126,176,.18)');
 for(let i=0;i<22000;i++){
  const r=Math.min(650,-Math.log(Math.max(random(),.001))*170),a=random()*Math.PI*2;
  g.fillStyle=`rgba(105,119,158,${.06+random()*.19})`;
  g.fillRect(center+Math.cos(a)*r,center+Math.sin(a)*r,.45+random()*.6,.45+random()*.6);
 }
 // Two dominant, irregular arms and fainter branches; no stroked spiral lines.
 for(let arm=0;arm<4;arm++){
  const major=arm%2===0,count=major?10500:4000;
  for(let i=0;i<count;i++){
   const r=85+Math.pow(random(),.75)*540;
   const a=arm*Math.PI/2+Math.log(r/85)*2.45+gaussian()*(major?.095:.16);
   const x=center+Math.cos(a)*r+gaussian()*8,y=center+Math.sin(a)*r+gaussian()*8;
   if(i%30===0)cloud(x,y,12+random()*24,`rgba(110,144,205,${major?.1:.055})`);
   if(i%160===0)cloud(x,y,7+random()*9,'rgba(193,131,164,.15)');
   g.fillStyle=`rgba(${random()>.18?'75,109,170':'169,120,147'},${.12+random()*(major?.48:.25)})`;
   const size=.45+Math.pow(random(),4)*1.9;g.fillRect(x,y,size,size);
   if(i%6===0){const d=a+.105;cloud(center+Math.cos(d)*r,center+Math.sin(d)*r,3+random()*6,'rgba(100,94,112,.075)');}
  }
 }
 cloud(center,center,150,'rgba(194,156,100,.5)');
 for(let i=0;i<11000;i++){
  const bar=i<6500,x=gaussian()*(bar?94:38),y=gaussian()*(bar?18:32);
  const a=.2,px=center+x*Math.cos(a)-y*Math.sin(a),py=center+x*Math.sin(a)+y*Math.cos(a);
  g.fillStyle=`rgba(160,120,71,${.12+random()*.38})`;g.fillRect(px,py,.5+random(),.5+random());
 }
 const ctx=canvas.getContext('2d'),screen=canvas.closest('section'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let frame=0,width=0,height=0,last=0,angle=-.4;
 function resize(){width=canvas.clientWidth;height=canvas.clientHeight;const dpr=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);draw();}
 function draw(){ctx.clearRect(0,0,width,height);if(!width || !height)return;const diameter=Math.max(width*2.6,height*2.4);ctx.save();ctx.translate(Math.max(80,(width-Math.min(600,width-48))/4),height*.5);ctx.rotate(-.4);ctx.scale(1,.68);ctx.rotate(angle);ctx.globalAlpha=.8;ctx.drawImage(texture,-diameter/2,-diameter/2,diameter,diameter);ctx.restore();}
 function tick(time){frame=0;if(!last)last=time;angle+=Math.min(time-last,100)*Math.PI*2/48000;last=time;draw();frame=requestAnimationFrame(tick);}
 function update(){const visible=!screen.classList.contains('hidden') && !document.body.classList.contains('auth-mode') && !document.hidden;if(frame){cancelAnimationFrame(frame);frame=0;}last=0;if(visible){draw();if(!reducedMotion())frame=requestAnimationFrame(tick);}}
 new ResizeObserver(resize).observe(canvas);new MutationObserver(update).observe(screen,{attributes:true,attributeFilter:['class']});new MutationObserver(update).observe(document.body,{attributes:true,attributeFilter:['class']});
 document.addEventListener('preferences-changed',update);document.addEventListener('visibilitychange',update);reduced.addEventListener('change',update);resize();update();
 return ()=>{cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',update);reduced.removeEventListener('change',update);};
}
