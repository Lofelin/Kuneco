import {isIP} from 'node:net';
// Keep connection diagnostics in English and copy only safe status fields.
export function proxyLogEvent(type,data={}){
 const reasons=[
  [/应用退出/,'Application shutting down'],[/代理已停止/,'Proxy stopped'],
  [/恢复上次/,'Restoring the previous environment and proxy'],
  [/正在通过指定代理核验/,'Verifying egress through the configured proxy'],
  [/正在连接当前环境/,'Connecting the current environment proxy'],
  [/固定出口核验成功/,'Fixed egress verified; proxy ready'],
  [/出口改变/,'Egress IP changed; forwarding locked'],
  [/记录保存失败/,'Failed to persist verified egress; forwarding blocked'],
  [/连续恢复失败/,'Proxy recovery exhausted; reconnect required'],
  [/(?:GOST|代理)内核退出|GOST 内核退出/,'Proxy core exited; waiting for recovery and egress verification'],
  [/(?:GOST |代理内核)恢复失败/,'Proxy recovery failed; retry pending without direct fallback'],
  [/暂未重新确认|检测暂不可用/,'Egress verification unavailable; preserving the existing proxy connection'],
  [/尚未成功验证|尚未验证出口/,'Egress not verified; forwarding blocked'],
  [/当前容器已停止/,'Current container stopped'],
  [/容器已启动/,'Container started; proxy verification required'],
  [/正在删除当前环境/,'Deleting current environment'],
  [/系统环境检测未通过/,'System checks failed; access blocked'],
  [/账号配置已切换/,'Account changed; proxy verification required']
 ];
 const reason=String(data.reason||'');
 const label=type==='requestFailure'?'Proxy forwarding request failed':reasons.find(([pattern])=>pattern.test(reason))?.[1]||'Proxy connection state changed';
 const fields=[];
 for(const key of ['state','verificationState','coreState','code'])if(typeof data[key]==='string'&&/^[a-zA-Z0-9_-]+$/.test(data[key]))fields.push(`${key}=${data[key]}`);
 if(isIP(data.ip||''))fields.push(`egress_ip=${data.ip}`);
 if(data.checkedAt&&Number.isFinite(Date.parse(data.checkedAt)))fields.push(`checked_at=${new Date(data.checkedAt).toISOString()}`);
 if(Number.isFinite(data.latencyMs))fields.push(`latency_ms=${data.latencyMs}`);
 if(typeof data.target==='string'&&/^[a-zA-Z0-9.:[\]-]+$/.test(data.target))fields.push(`target=${data.target}`);
 const level=type==='requestFailure'||['stale','unavailable'].includes(data.verificationState)||/failed|exhausted|locked|exited/.test(label)?'WARN':'INFO';
 return {source:'Proxy connection and verification',level,message:[label,...fields].join(' · ')};
}
