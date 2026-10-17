// Cached tokens are separate in Claude usage, but already included in Codex input_tokens.
export function totalUsageTokens(engine, result) {
 const fields=engine==='codex'?['input_tokens','output_tokens']:['inputTokens','outputTokens','cacheReadInputTokens','cacheCreationInputTokens'];
 const rows=engine==='codex'?[result]:Object.values(result?.modelUsage || {});
 if(!rows.length)return null;
 let total=0;
 for(const row of rows){
  if(!row || !fields.every(key=>Number.isSafeInteger(row[key]) && row[key]>=0))return null;
  total+=fields.reduce((sum,key)=>sum+row[key],0);
 }
 return Number.isSafeInteger(total)?total:null;
}
