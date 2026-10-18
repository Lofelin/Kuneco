export function runDeepSeek({spawnProcess,sessionId,model,prompt,history,project,networkMode='proxy',signal,onText,onReasoning=()=>{},onFinish=()=>{},onActivity=()=>{},onCompaction=()=>{},onUsage=()=>{},browserTool}){
 return new Promise((resolve,reject)=>{
  const child=spawnProcess({command:'node',args:['/home/node/.local/lib/dingtu/deepseek.mjs','chat'],signal});
  let closed=false;const pendingTools=new Set();
  const abort=()=>{closed=true;child.stdin.end();child.kill();};signal?.addEventListener('abort',abort,{once:true});
  const browserRequest=event=>{
   if(closed || finished || signal?.aborted)return;
   if(!browserTool || typeof event.id!=='string' || !event.id || pendingTools.has(event.id))throw new Error('浏览器工具请求无效');
   pendingTools.add(event.id);void (async()=>{let response;try{response=JSON.stringify({type:'browser-tool-result',id:event.id,result:await browserTool.execute(event.input)});}catch(error){response=JSON.stringify({type:'browser-tool-result',id:event.id,error:String(error?.message || error)});}
    if(!closed && !signal?.aborted && !child.stdin.destroyed && !child.stdin.writableEnded)child.stdin.write(response+'\n');
   })();
  };
  let output='',error='',streamed=false,finished=false,usage,parseError,runtimeError,total=0;
  const consume=line=>{if(!line.trim())return;const event=JSON.parse(line);if(event.type==='browser-tool-request'){browserRequest(event);}else if(event.type==='delta' && typeof event.text==='string'){streamed=true;onText(event.text);}else if(event.type==='reasoning' && typeof event.text==='string'){onReasoning(event.text);}else if(event.type==='activity' && event.activity?.id){onActivity(event.activity);}else if(event.type==='usage'&&event.usage){onUsage(event.usage);}else if(event.type==='compaction'&&event.record){onCompaction(event.record);}else if(event.type==='error'){runtimeError=Object.assign(new Error(event.message || 'DeepSeek 请求失败'),{recovery:event.recovery});}else if(event.type==='done'){finished=true;usage=event.usage;onFinish(event.finishReason);if(browserTool)child.stdin.end();}else if(typeof event.text==='string'){if(!streamed)onText(event.text);finished=true;usage=event.usage;}else throw new Error('DeepSeek 回复格式无效');};
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',text=>{total+=text.length;output+=text;try{if(total>20_000_000)throw new Error('响应过大');let end;while((end=output.indexOf('\n'))!==-1){consume(output.slice(0,end));output=output.slice(end+1);}}catch(error){parseError=error;child.kill();}});
  child.stderr.on('data',text=>{error=(error+text).slice(-1000);});
  child.once('error',()=>{closed=true;signal?.removeEventListener('abort',abort);reject(new Error('DeepSeek 运行时启动失败'));});
  child.once('close',code=>{closed=true;signal?.removeEventListener('abort',abort);if(signal?.aborted)return reject(new Error('请求已取消'));if(code!==0){try{if(output.trim())consume(output);}catch{}return reject(runtimeError || new Error(error.trim() || 'DeepSeek 请求失败'));}try{if(runtimeError)throw runtimeError;if(parseError)throw parseError;if(output.trim())consume(output);if(!finished)throw new Error();resolve(usage);}catch{reject(new Error('DeepSeek 回复格式无效'));}});
  child.stdin.on('error',()=>{});const input={sessionId,model,prompt,networkMode,history,project};if(browserTool)child.stdin.write(JSON.stringify({...input,browserTool:{definition:browserTool.definition}})+'\n');else child.stdin.end(JSON.stringify(input));if(signal?.aborted)abort();
 });
}
