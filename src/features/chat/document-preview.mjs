import {openPdf,renderPdfPage} from './pdf-preview.mjs';
import {mountImageGallery} from './image-gallery.mjs';
const previews=new WeakMap();
export async function previewChatDocument(doc,item){
 if(item.kind==='pdf'&&item.pdfData)return previewPdf(doc,item);
 let dialog=previews.get(doc);
 if(!dialog?.isConnected){dialog=doc.createElement('app-dialog');dialog.className='chat-document-preview';doc.body.append(dialog);previews.set(doc,dialog);}
 dialog.setAttribute('label',item.name);
 const note=doc.createElement('p');note.className='settings-section-description';
 note.textContent=item.kind==='pdf'?'PDF 已提取文本；历史附件未保存原文件，无法还原原始版式。':'附件内容';
 const content=doc.createElement('pre');content.textContent=item.text;
 dialog.replaceChildren(note,content);await dialog.updateComplete;dialog.open=true;
 return dialog;
}

async function previewPdf(doc,item){
 const dialog=doc.createElement('app-dialog');dialog.className='chat-pdf-preview';dialog.setAttribute('label',item.name);
 const title=doc.createElement('span');title.slot='label';title.title=item.name;title.textContent=item.name;dialog.append(title);
 const controls=doc.createElement('div');controls.slot='header-actions';controls.className='deepseek-preview-controls';
 const zoom=doc.createElement('wa-select');zoom.setAttribute('aria-label','PDF 缩放');zoom.size='small';
 for(const [value,label] of [['fit','适应窗口'],['50','50%'],['100','100%'],['150','150%'],['200','200%']]){const option=doc.createElement('wa-option');option.value=value;option.textContent=label;zoom.append(option);}controls.append(zoom);
 const stage=doc.createElement('div');stage.className='deepseek-preview-stage';const image=doc.createElement('img');image.alt=item.name;stage.append(image);
 const status=doc.createElement('p');status.className='pdf-preview-status';status.textContent='正在读取 PDF…';dialog.append(controls,status,stage);doc.body.append(dialog);
 let task,closed=false,selection=0;
 dialog.addEventListener('wa-hide',event=>{if(event.target!==dialog)return;closed=true;selection++;void task?.destroy();});dialog.addEventListener('wa-after-hide',event=>{if(event.target===dialog)dialog.remove();});
 await dialog.updateComplete;dialog.open=true;
 try{
  task=await openPdf(item.pdfData);if(closed){await task.destroy();return dialog;}const pdf=await task.promise;
  if(closed)return dialog;
  const gallery=mountImageGallery({preview:dialog,stage,image,controls,zoom,scope:()=>item,labels:{previous:'上一页',next:'下一页',reset:'重置缩放与位置'},onSelect:async page=>{
   const token=++selection;status.hidden=false;status.textContent='正在渲染第 '+page.number+' 页…';image.hidden=true;
   try{const url=await renderPdfPage(pdf,page.number,doc);if(closed||token!==selection)return;image.src=url;image.hidden=false;status.hidden=true;}catch(error){if(!closed&&token===selection)status.textContent='PDF 页面加载失败：'+error.message;}
  }});
  const pages=Array.from({length:pdf.numPages},(_,i)=>({number:i+1,url:'pdf-page:'+i}));gallery.open(pages,pages[0]);
 }catch(error){if(!closed)status.textContent='PDF 预览失败：'+error.message;}
 return dialog;
}
