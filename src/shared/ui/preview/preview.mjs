import {setUITheme} from '../../../vendor/ui.js';
import {renderAppTable} from '../app-table.mjs';
import {mountScrollFade} from '../scroll-fade.mjs';

const byId=id=>document.getElementById(id);
const status=text=>{byId('previewStatus').textContent=text;};
const state={activations:0,menuActions:0,submissions:0,lastSubmission:null};

function setTheme(theme){
 const dark=theme==='dark';document.body.classList.toggle('dark',dark);setUITheme(dark);byId('previewTheme').value=dark?'dark':'light';
}
function setWidth(width){byId('previewContent').dataset.width=width;byId('previewWidth').value=width;}
byId('previewTheme').addEventListener('change',event=>setTheme(event.target.value));
byId('previewWidth').addEventListener('change',event=>setWidth(event.target.value));
setWidth('wide');
for(let i=0;i<18;i++){const line=document.createElement('p');line.textContent=`示例记录 ${i+1}：滚动至边缘后对应渐隐消失。`;byId('previewScrollFade').append(line);}
mountScrollFade(byId('previewScrollFade'));

for(const button of byId('previewButtons').querySelectorAll('app-button'))button.addEventListener('click',()=>status('已触发示例操作；未保存或删除任何数据。'));
byId('previewForm').addEventListener('submit',event=>{
 event.preventDefault();state.submissions++;state.lastSubmission={name:byId('previewName').value,language:byId('previewSelect').value,count:byId('previewCount').value,notes:byId('previewNotes').value,checked:byId('previewCheck').checked,mode:byId('previewMode').value};
 status('校验通过：'+JSON.stringify(state.lastSubmission));
});
for(const [button,dialog] of [['previewOpenStandard','previewStandardDialog'],['previewOpenCustom','previewCustomDialog'],['previewOpenReadonly','previewReadonlyDialog']])byId(button).addEventListener('click',()=>byId(dialog).show());
for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',()=>byId(button.dataset.close).hide());
for(const button of document.querySelectorAll('[data-confirm]'))button.addEventListener('click',()=>{status('已确认本地示例。');byId(button.dataset.confirm).hide();});
byId('previewDialogForm').addEventListener('submit',event=>{event.preventDefault();status('弹窗表单通过校验：'+byId('previewCustomInput').value);byId('previewCustomDialog').hide();});
for(let i=0;i<16;i++){const line=document.createElement('p');line.textContent=`滚动内容 ${i+1}：检查标题与底部按钮保持可见，分隔线贯穿弹窗内宽。`;byId('previewDialogLongContent').append(line);}

function menu(){
 const dropdown=document.createElement('wa-dropdown');
 dropdown.innerHTML='<app-button slot="trigger" appearance="plain" aria-label="示例行操作"><wa-icon src="assets/icons/ellipsis.svg" aria-hidden="true"></wa-icon></app-button><wa-dropdown-item value="copy"><wa-icon slot="icon" src="assets/icons/copy.svg" aria-hidden="true"></wa-icon>复制示例</wa-dropdown-item><wa-dropdown-item value="remove" variant="danger"><wa-icon slot="icon" src="assets/icons/trash-2.svg" aria-hidden="true"></wa-icon>删除示例（仅提示）</wa-dropdown-item>';
 return dropdown;
}
const columns=[{key:'name',label:'名称',width:'24%'},{key:'description',label:'说明'},{key:'link',label:'链接',width:'100px',render:()=>{const link=document.createElement('a');link.href='#previewTables';link.textContent='示例链接';link.addEventListener('click',event=>{event.preventDefault();status('示例链接独立操作；未激活行。');});return link;}}];
renderAppTable(byId('previewTable'),{columns,rows:[{name:'示例环境',description:'可点击行：点击、Enter 或空格激活。'},{name:'包含很长名称的本地演示记录',description:'这段很长的说明用于检查内容自动换行与表头对齐。'.repeat(8)}],label:'交互表格示例',minWidth:580,onActivate:item=>{state.activations++;status('已激活示例行：'+item.name);},rowLabel:item=>'查看 '+item.name,actions:menu});
renderAppTable(byId('previewEmptyTable'),{columns,rows:[],label:'空表格示例',minWidth:580,empty:'暂无示例记录'});
document.addEventListener('wa-select',event=>{if(event.target.localName==='wa-dropdown'){state.menuActions++;status('示例菜单：'+(event.detail.item.value==='remove'?'模拟删除；数据未改变':'模拟复制')+'。');}});

// Read-only hooks for the isolated Electron acceptance runner. No business IPC.
window.uiPreview={setTheme,setWidth,state};
await Promise.all([...document.querySelectorAll('*')].filter(el=>el.localName.startsWith('wa-')||el.localName.startsWith('app-')).map(el=>el.updateComplete));
await document.fonts.ready;
window.uiPreview.ready=true;
