export const PDF_MAX_BYTES=50*1024*1024;
export function encodePdf(bytes){let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
export function validatePdfData(value,size){
 if(typeof value!=='string'||value.length>Math.ceil(PDF_MAX_BYTES/3)*4||value.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw new Error('PDF 原文件无效');
 const raw=atob(value);if(raw.length!==size||!raw.startsWith('%PDF-'))throw new Error('PDF 原文件无效');return value;
}
export async function openPdf(data){
 const pdf=await import('../../vendor/pdf.mjs');pdf.GlobalWorkerOptions.workerSrc=new URL('../../vendor/pdf.worker.mjs',import.meta.url).href;
 return pdf.getDocument({data:typeof data==='string'?Uint8Array.from(atob(data),c=>c.charCodeAt(0)):data,isEvalSupported:false,
 cMapUrl:new URL('../../vendor/pdf-cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('../../vendor/pdf-fonts/',import.meta.url).href,wasmUrl:new URL('../../vendor/pdf-wasm/',import.meta.url).href});
}
export async function renderPdfPage(pdf,number,doc,width=1600){
 const page=await pdf.getPage(number),base=page.getViewport({scale:1}),scale=Math.min(width/base.width,2200/base.height,2);
 const viewport=page.getViewport({scale}),canvas=doc.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
 try{await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;return canvas.toDataURL('image/png');}finally{page.cleanup();canvas.width=canvas.height=0;}
}
export async function pdfThumbnail(data,doc){const task=await openPdf(data);try{return await renderPdfPage(await task.promise,1,doc,360);}finally{await task.destroy();}}
