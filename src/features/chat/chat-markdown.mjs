import {adoptChatDiagrams} from './diagrams.mjs';
import {adoptCodeBlocks,captureCodeSelection,restoreCodeSelection} from './code-blocks.mjs';
import {adoptAppTables} from '../../shared/ui/app-table.mjs';
import {marked} from 'marked';
import DOMPurify from 'dompurify';
export function renderChatMarkdown(text){
 const html=marked.parse(String(text),{gfm:true,breaks:true});
 return DOMPurify.sanitize(html,{ALLOWED_TAGS:['p','br','strong','em','del','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','table','thead','tbody','tr','th','td','hr','a'],ALLOWED_ATTR:['href','title','start','align','class'],ALLOW_DATA_ATTR:false});
}
export function updateChatMessage(node,text){
 const selection=captureCodeSelection(node),previous=[...node.querySelectorAll('.chat-code-block')];
 const fragment=node.ownerDocument.createElement('div');fragment.innerHTML=renderChatMarkdown(text);
 adoptCodeBlocks(fragment,{previous});
 node.dataset.rawText=text;node.classList.add('markdown-body');node.replaceChildren(...fragment.childNodes);adoptAppTables(node);void adoptChatDiagrams(node);restoreCodeSelection(selection);
 for(const link of node.querySelectorAll('a')){link.target='_blank';link.rel='noopener noreferrer';}
}
