const segmenter=new Intl.Segmenter('zh-CN',{granularity:'word'});
function terms(text){const value=String(text||'').normalize('NFKC').toLowerCase(),result=[];for(const p of segmenter.segment(value))if(p.isWordLike&&p.segment.length>1)result.push(p.segment);for(const run of value.match(/[\p{Script=Han}]+/gu)||[])for(let i=0;i<run.length-1;i++)result.push(run.slice(i,i+2));return result;}
export function memoryTokens(text){return new Set(terms(text));}
export function normalizedMemory(text){return String(text||'').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');}
export function memoryContextEntry({id,revision,layer='L1',title,content,memberRefs}){return {id,revision,layer,title,content,...(memberRefs?{memberRefs}:{})};}
export function cosine(a,b){if(!a||!b||a.length!==b.length)return 0;let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?dot/Math.sqrt(aa*bb):0;}
export function rankMemoryCandidates(items,query,{project=null,includeInactive=false,vectors=new Map(),queryVector,minSimilarity=.5}={}){
 const candidates=items.filter(i=>(includeInactive?i.status!=='resolved':i.enabled&&i.status==='active')&&(!i.project||i.project===project)),queryTerms=memoryTokens(query),frequency=new Map();
 const docs=candidates.map(item=>{const words=[...terms(item.content),...terms(item.title),...terms(item.title),...terms((item.keywords||[]).join(' '))],tf=new Map();for(const word of words)tf.set(word,(tf.get(word)||0)+1);for(const word of tf.keys())frequency.set(word,(frequency.get(word)||0)+1);return {item,tf,length:Math.max(1,words.length)};});
 const average=docs.reduce((n,d)=>n+d.length,0)/Math.max(1,docs.length);
 const keyword=docs.map(d=>{let score=0;for(const word of queryTerms){const tf=d.tf.get(word)||0;if(tf){const df=frequency.get(word);score+=Math.log(1+(docs.length-df+.5)/(df+.5))*tf*2.2/(tf+1.2*(.25+.75*d.length/average));}}return {item:d.item,score};}).filter(v=>v.score>0).sort((a,b)=>b.score-a.score);
 const semantic=queryVector?candidates.map(item=>({item,score:cosine(queryVector,vectors.get(item.id))})).filter(v=>v.score>=minSimilarity).sort((a,b)=>b.score-a.score):[];
 const fused=new Map();for(const [name,list]of [['keyword',keyword],['semantic',semantic]])for(const [rank,v]of list.entries()){const value=fused.get(v.item.id)||{item:v.item,score:0,keyword:0,semantic:0,matched:true};value.score+=1/(60+rank+1);value[name]=v.score;fused.set(v.item.id,value);}
 for(const item of candidates)if(!fused.has(item.id)&&(item.pinned||item.type==='preference')&&!includeInactive)fused.set(item.id,{item,score:0,matched:false,keyword:0,semantic:0});
 return [...fused.values()].sort((a,b)=>(b.score+(b.item.pinned?1000:0))-(a.score+(a.item.pinned?1000:0))||b.item.updatedAt.localeCompare(a.item.updatedAt));
}
export function selectRecalledMemories(ranked,{limit=8,budget=6000}={}){
 const result=[],covered=new Set();let used=2,globalPreferences=0;
 for(const {item,matched}of ranked){if(result.length>=limit)break;if(covered.has(item.id)||item.memberRefs?.some(ref=>covered.has(ref.id)))continue;if(!item.pinned&&!matched&&globalPreferences>=3)continue;const size=JSON.stringify(memoryContextEntry(item)).length+1;if(used+size>budget)continue;result.push(structuredClone(item));used+=size;covered.add(item.id);for(const ref of item.memberRefs||[])covered.add(ref.id);if(!matched&&!item.pinned)globalPreferences++;}return result;
}
export function recallMemories(items,query,options={}){return selectRecalledMemories(rankMemoryCandidates(items,query,options),options);}
