const terminal = new Set(['completed','stopped','failed']);
export const isReasoningTerminal = phase => terminal.has(phase);
const timeField = phase => ({waiting:'waitingMs',thinking:'thinkingMs',process:'processMs'}[phase]);

// Durations describe observed stream phases, never inferred model computation.
export function reasoningSnapshot(state,now=Date.now()){
 const snapshot={text:state.text,kind:state.kind,phase:state.phase,waitingMs:state.waitingMs || 0,thinkingMs:state.thinkingMs || 0,processMs:state.processMs || 0,activities:state.activities,userExpanded:state.userExpanded};
 const field=timeField(state.phase);
 if(field && Number.isFinite(state.phaseStartedAt))snapshot[field]+=Math.max(0,now-state.phaseStartedAt);
 snapshot.durationMs=snapshot.kind==='process'?snapshot.processMs:snapshot.thinkingMs;
 return snapshot;
}
export function updateReasoningState(previous,options={},now=Date.now()){
 if(previous && isReasoningTerminal(previous.phase))return previous;
 const kind=options.kind || previous?.kind || 'thinking';
 let phase=options.phase || (options.complete?'completed':(options.text?.trim() || options.activities?.length)?(kind==='process'?'process':'thinking'):previous?.phase || (kind==='process'?'process':'waiting'));
 if(!previous && options.complete){
  // A restored in-flight message has no request to resume. Preserve its measured
  // durations and mark interruption instead of counting time while the app was shut.
  phase=options.phase?(isReasoningTerminal(options.phase)?options.phase:'stopped'):'completed';
 }
 const state=previous || {kind,text:'',phase,waitingMs:options.waitingMs || 0,thinkingMs:options.thinkingMs ?? (kind==='thinking'?options.durationMs || 0:0),processMs:options.processMs ?? (kind==='process'?options.durationMs || 0:0),phaseStartedAt:options.startedAt ?? now,userExpanded:options.userExpanded};
 if(previous){Object.assign(state,reasoningSnapshot(state,now));state.phaseStartedAt=now;}
 state.kind=kind;state.phase=phase;
 if(options.text!==undefined)state.text=options.text;
 if(options.activities!==undefined && options.activities!==null)state.activities=options.activities;
 if(isReasoningTerminal(phase)){
  state.phaseStartedAt=null;
  state.activities=state.activities?.map(activity=>['in_progress','inProgress','pending','paused'].includes(activity.status)?{...activity,status:phase==='completed'?'interrupted':phase}:activity);
 }
 state.durationMs=reasoningSnapshot(state,now).durationMs;
 return state;
}
