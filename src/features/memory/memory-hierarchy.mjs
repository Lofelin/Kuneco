import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
function boundedMembers(items,max){const selected=[];let size=0;for(const item of items){if(size+item.content.length+3>max)continue;selected.push(item);size+=item.content.length+3;}return selected;}
export function buildMemoryHierarchy(items,{project=null,allProjects=false}={}){
 const atoms=items.filter(i=>i.status==='active'&&i.enabled&&(allProjects||!i.project||i.project===project));
 const evidence=new Map();for(const item of atoms)for(const source of item.sources||[]){const id=source.jobId+':'+source.quote;if(!evidence.has(id))evidence.set(id,{...source,id,layer:'L0',memoryIds:[]});evidence.get(id).memoryIds.push(item.id);}
 const derived=(layer,title,members,group)=>{const refs=members.map(i=>({id:i.id,revision:i.revision})),content=members.map(i=>'• '+i.content).join('\n'),scope=members[0];return {id:'derived:'+digest(JSON.stringify([scope.owner,scope.environmentId,layer,group])).slice(0,24),owner:scope.owner,environmentId:scope.environmentId,layer,title,content,type:layer==='L3'?'preference':'note',key:group,project:members[0].project||null,enabled:true,status:'active',origin:'derived',pinned:false,revision:parseInt(digest(JSON.stringify(refs)).slice(0,10),16),updatedAt:members.map(i=>i.updatedAt).sort().at(-1),createdAt:members.map(i=>i.createdAt).sort()[0],memberRefs:refs,keywords:[...new Set(members.flatMap(i=>i.keywords||[]))].slice(0,24),sources:members.flatMap(i=>i.sources||[])};};
 const groups=new Map();for(const item of atoms){const scene=item.scene?.trim()||item.project||'';if(!scene)continue;const key=JSON.stringify([item.project||null,scene]);if(!groups.has(key))groups.set(key,{scene,members:[]});groups.get(key).members.push(item);}
 const scenes=[];for(const [key,group]of groups){const members=boundedMembers(group.members.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,12),3000);if(members.length>=2)scenes.push(derived('L2',group.scene+' · 场景摘要',members,key));}
 const preferences=boundedMembers(atoms.filter(i=>!i.project&&i.type==='preference'&&(i.manualProtected||i.pinned||(new Set((i.sources||[]).map(s=>s.turnId))).size>=2)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,8),2400);
 const profiles=preferences.length?[derived('L3','稳定偏好',preferences,'explicit-preferences')]:[];
 return {L0:[...evidence.values()],L1:atoms.map(i=>({...i,layer:'L1'})),L2:scenes,L3:profiles};
}
