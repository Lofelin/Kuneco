export function validateSessionOptions(options = {}) {
  if (!options || typeof options !== 'object' || !['cc','codex','deepseek'].includes(options.engine)) throw new Error('请选择有效运行时');
  const model=options.model ?? null;
  if(model!==null && (typeof model!=='string' || !/^[a-zA-Z0-9._:-]{1,100}$/.test(model)))throw new Error('请选择有效模型');
  const networkMode=options.networkMode ?? 'proxy';
  if(!['proxy','direct','auto'].includes(networkMode))throw new Error('请选择有效连接方式');
  return {engine:options.engine,model,networkMode};
}
