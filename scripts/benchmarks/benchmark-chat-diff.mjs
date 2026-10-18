// Compare with an earlier source snapshot using --source-dir=/absolute/path.
// That directory must contain file-diff.mjs, review-diff.mjs and code-blocks.mjs.
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
const sourceDir=process.argv.find(arg=>arg.startsWith('--source-dir='))?.slice(13)||resolve('src/features/chat');
const {renderFileDiffs}=await import(pathToFileURL(resolve(sourceDir,'file-diff.mjs')));
const {renderReviewDiff,reviewRows}=await import(pathToFileURL(resolve(sourceDir,'review-diff.mjs')));
const {adoptCodeBlocks}=await import(pathToFileURL(resolve(sourceDir,'code-blocks.mjs')));
const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;globalThis.CustomEvent=dom.window.CustomEvent;
const host=document.querySelector('main'),source='unchanged source line\n'.repeat(5000),change={path:'large.txt',before:source,after:source+'new line\n'};
function measure(name,run,iterations=3){const values=[];let nodes;for(let i=0;i<iterations;i++){host.replaceChildren();const start=performance.now();run();values.push(performance.now()-start);nodes=host.querySelectorAll('*').length;}values.sort((a,b)=>a-b);console.log(JSON.stringify({name,medianMs:+values[Math.floor(values.length/2)].toFixed(2),elements:nodes}));}
measure('collapsed activity: 5000 lines',()=>renderFileDiffs(host,{changes:[change]}));
measure('folded review: 5000 lines',()=>renderReviewDiff(host,change));
measure('same change parsed 100 times',()=>{for(let i=0;i<100;i++)reviewRows(change);});
measure('stream code: 5000 lines + 50 tokens',()=>{
 let previous=[],text=source;
 for(let i=0;i<50;i++){text+='x';const pre=document.createElement('pre'),code=document.createElement('code');code.textContent=text;pre.append(code);host.replaceChildren(pre);previous=adoptCodeBlocks(host,{previous});}
});
dom.window.close();
