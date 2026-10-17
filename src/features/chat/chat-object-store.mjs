import {createHash} from 'node:crypto';
const FORMAT='dingtu-chat-objects-v1',CHARS=128*1024;
export async function encodeChatPayload(payload,put){
 const seen=new Map();let scope='_index';
 async function store(text){let next=null;for(let end=text.length;end>0;){const start=Math.max(0,end-CHARS);const value={data:text.slice(start,end),next};const id=createHash('sha256').update(JSON.stringify(value)).digest('hex');await put(id,value,scope);next=id;end=start;}return next;}
 const copy=structuredClone(payload);const groups=[];
 const environments=new Set((copy?.sessions || []).map(session=>session.environmentId || '_local'));
 for(const environment of environments){scope=environment;const sessions=copy.sessions.filter(session=>(session.environmentId || '_local')===environment),ids=new Set(sessions.map(session=>session.id));const views=(copy.views || []).filter(view=>ids.has(view.id));
 for(const view of views)for(const message of view.messages || [])for(const image of message.images || [])if(image.dataURL){const key=scope+':'+image.dataURL;let head=seen.get(key);if(!head){head=await store(image.dataURL);seen.set(key,head);}delete image.dataURL;image.objectRef=head;}
 groups.push({environment,head:await store(JSON.stringify({sessions,views}))});}
 scope='_index';const index={...copy,sessions:undefined,views:undefined,groups};

 return {format:FORMAT,head:await store(JSON.stringify(index))};
}
export async function decodeChatPayload(payload,get){
 if(payload?.format!==FORMAT)return payload;
 async function load(head,scope){let text='',next=head;const seen=new Set();while(next){if(!/^[a-f0-9]{64}$/.test(next)||seen.has(next))throw new Error('聊天分块引用无效');seen.add(next);const value=await get(next,scope);if(typeof value?.data!=='string' || !(value.next===null || /^[a-f0-9]{64}$/.test(value.next)))throw new Error('聊天分块数据无效');const hash=createHash('sha256').update(JSON.stringify({data:value.data,next:value.next})).digest('hex');if(hash!==next)throw new Error('聊天分块校验失败');text+=value.data;next=value.next;}return text;}
 const index=JSON.parse(await load(payload.head,'_index'));const copy={...index,sessions:[],views:[]};delete copy.groups;
 for(const group of index.groups || []){const {environment}=group;const data=JSON.parse(await load(group.head,environment));const images=new Map();
 for(const view of data.views || [])for(const message of view.messages || [])for(const image of message.images || [])if(image.objectRef){if(!images.has(image.objectRef))images.set(image.objectRef,await load(image.objectRef,environment));image.dataURL=images.get(image.objectRef);delete image.objectRef;}
 copy.sessions.push(...data.sessions);copy.views.push(...data.views);}
 return copy;
}
