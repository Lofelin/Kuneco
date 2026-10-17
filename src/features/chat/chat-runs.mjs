// A slot is reserved before asynchronous preflight, preventing duplicate sends
// in one conversation without serializing unrelated conversations.
export class ChatRuns extends Map {
 begin(chatId,metadata={}){
  if(this.has(chatId))throw new Error('当前对话正在处理请求');
  const controller=new AbortController();Object.assign(controller,metadata,{chatId});
  controller.finished=new Promise(resolve=>controller.resolveFinished=resolve);
  this.set(chatId,controller);return controller;
 }
 finish(controller){if(this.get(controller.chatId)===controller)this.delete(controller.chatId);controller.resolveFinished();}
 abortWhere(predicate=()=>true){const tasks=[...this.values()].filter(predicate);for(const task of tasks)task.abort();return Promise.all(tasks.map(task=>task.finished));}
}
