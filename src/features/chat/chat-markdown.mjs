import {adoptAppTables} from '../../shared/ui/app-table.mjs';
import {marked} from 'marked';
import DOMPurify from 'dompurify';
export function renderChatMarkdown(text){
 const html=marked.parse(String(text),{gfm:true,breaks:true});
 return DOMPurify.sanitize(html,{ALLOWED_TAGS:['p','br','strong','em','del','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','table','thead','tbody','tr','th','td','hr','a'],ALLOWED_ATTR:['href','title','start','align','class'],ALLOW_DATA_ATTR:false});
}
export function updateChatMessage(node,text){
 node.dataset.rawText=text;node.classList.add('markdown-body');node.innerHTML=renderChatMarkdown(text);adoptAppTables(node);
 for(const link of node.querySelectorAll('a')){link.target='_blank';link.rel='noopener noreferrer';}
}
