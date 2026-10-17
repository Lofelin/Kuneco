import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installBrowserPolicy, FONT_CSS } from '../src/browser-policy.mjs';

test('downloaded icon fonts survive normalization without allowing local font sources',()=>{
 const style=(fontFamily,src='')=>({fontFamily,src,getPropertyValue(name){return name==='src'?src:'';},getPropertyPriority:()=>'',setProperty(name,value){if(name==='font-family')this.fontFamily=value;if(name==='src')this.src=value;}});
 const variableIcon=style('var(--site-icon-font, sans-serif)'),lateIcon=style('LateIcons');
 const icon=style('SiteIcons'),face=style('SiteIcons','url("/icons.woff2")'),blocked=style('"PingFang SC", sans-serif');
 const handlers={};class FontFace{constructor(family,source){this.family=family;this.source=source;}}
 const sandbox={FontFace,DOMException,MutationObserver:class{observe(){}},document:{styleSheets:[{cssRules:[{type:5,style:face},{style:icon},{style:blocked},{style:variableIcon},{style:lateIcon}]}],querySelectorAll:()=>[],addEventListener(name,fn){handlers[name]=fn;}}};
 vm.runInNewContext(`(${installBrowserPolicy.toString()})()`,sandbox);handlers.DOMContentLoaded();
 assert.equal(variableIcon.fontFamily,'var(--site-icon-font, sans-serif)');assert.equal(lateIcon.fontFamily,'LateIcons');assert.equal(face.fontFamily,'SiteIcons');assert.equal(icon.fontFamily,'SiteIcons');assert.equal(blocked.fontFamily,'sans-serif');
 assert.doesNotThrow(()=>new sandbox.FontFace('DynamicIcons','url("/dynamic.woff2")'));
 assert.throws(()=>new sandbox.FontFace('probe','local("DynamicIcons")'),{name:'NotAllowedError'});
 assert.throws(()=>new sandbox.FontFace('probe','local("PingFang SC")'),{name:'NotAllowedError'});
 assert.doesNotMatch(FONT_CSS,/\*\s*\{|!important/);
});

test('declared cross-origin and delayed fonts can load while undeclared system probes remain blocked',async()=>{
 class FontFaceSet extends Set {check(){return true;}load(){return Promise.resolve(['loaded']);}}
 class FontFace {constructor(family,source){this.family=family;this.source=source;}}
 class CanvasRenderingContext2D {get font(){return this.value;}set font(value){this.value=value;}}
 const fonts=new FontFaceSet();const sandbox={FontFaceSet,FontFace,CanvasRenderingContext2D,DOMException};
 vm.runInNewContext(`(${installBrowserPolicy.toString()})()`,sandbox);
 assert.equal(fonts.check('16px "Unknown Local Font"'),false);
 assert.equal((await fonts.load('16px "Unknown Local Font"')).length,0);
 fonts.add({family:'Material Symbols Outlined'});
 assert.equal(fonts.check('24px "Material Symbols Outlined"'),true);
 assert.deepEqual(await fonts.load('24px "Material Symbols Outlined"'),['loaded']);
 new sandbox.FontFace('BinaryIcons',new Uint8Array([0,1]));fonts.add({family:'BinaryIcons'});
 assert.equal(fonts.check('16px BinaryIcons'),true);
 const ctx=new CanvasRenderingContext2D();ctx.font='24px "Material Symbols Outlined"';assert.equal(ctx.font,'24px "Material Symbols Outlined"');
 ctx.font='20px "PingFang SC", monospace';assert.equal(ctx.font,'20px monospace');
});
