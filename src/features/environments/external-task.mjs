// External containers need a process-group primitive; never pretend a plain PID
// kill can cancel descendants. No Node installation is required in the container.
const taskPath=token=>{if(!/^[a-f0-9-]{36}$/.test(token))throw new Error('无效容器任务');return '/tmp/kuneco-task-'+token;};
export const externalTaskCapabilityScript='command -v setsid >/dev/null && command -v sleep >/dev/null && command -v mkdir >/dev/null && command -v rm >/dev/null && command -v cat >/dev/null';
export async function verifyExternalTaskCapabilities(manager,item){
 try{await manager.command(['exec',item.external.id,'sh','-c',externalTaskCapabilityScript],{endpoint:item.external.endpoint});}
 catch{throw new Error('已有容器缺少 setsid 或任务清理工具，无法可靠取消任务；请安装后重试');}
}
export const externalTaskScript=`
p="$1"; shift
umask 077
mkdir -p "$p" || exit 1
if test -f "$p/cancel"; then : > "$p/done"; exit 143; fi
exec 3<&0
setsid sh -c 'p="$1"; shift; echo "$$" > "$p/pid"; if test -f "$p/cancel"; then exit 143; fi; exec "$@"' kuneco-task "$p" "$@" <&3 &
pid=$!
wait "$pid"; code=$?
# A command may finish while descendants still own its process group.
if kill -TERM "-$pid" 2>/dev/null; then
 sleep 1
 kill -KILL "-$pid" 2>/dev/null || :
fi
: > "$p/done"
exit "$code"
`;
export function externalTaskArguments(token,command,args=[]){return ['sh','-c',externalTaskScript,'kuneco-task',taskPath(token),command,...args];}
export const externalTaskCancelScript=`
p="$1"
umask 077
mkdir -p "$p" || exit 1
: > "$p/cancel" || exit 1
n=0
while ! test -f "$p/done"; do
 if test -f "$p/pid"; then
  pid=$(cat "$p/pid")
  case "$pid" in ''|*[!0-9]*) exit 1;; esac
  test "$pid" -gt 1 || exit 1
  kill -TERM "-$pid" 2>/dev/null || :
  sleep 1
  kill -KILL "-$pid" 2>/dev/null || :
 fi
 n=$((n+1)); test "$n" -lt 10 || exit 1
 sleep 1
done
rm -rf "$p"
`;
export function externalTaskCancellation(manager,item,token){
 const p=taskPath(token);let pending;
 return ()=>{
  if(pending)return pending;
  const attempt=manager.command(['exec',item.external.id,'sh','-c',externalTaskCancelScript,'kuneco-cancel',p],{endpoint:item.external.endpoint,timeout:25000});
  pending=attempt;void attempt.catch(()=>{if(pending===attempt)pending=null;});
  return attempt;
 };
}
