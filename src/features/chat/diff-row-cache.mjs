// Cache only the current snapshot of a change. Weak keys release source and rows
// with the activity; replacing a streamed snapshot invalidates it immediately.
const snapshots=new WeakMap();
export function cachedChangeRows(change,parse){
 const snapshot=typeof change.before==='string'&&typeof change.after==='string'
  ?{before:change.before,after:change.after,diff:null}
  :{before:null,after:null,diff:change.diff||''};
 const cached=snapshots.get(change);
 if(cached&&cached.before===snapshot.before&&cached.after===snapshot.after&&cached.diff===snapshot.diff)return cached.rows;
 const rows=parse(snapshot);
 snapshots.set(change,{...snapshot,rows});
 return rows;
}
