import {readFile,writeFile} from 'node:fs/promises';
const [localFile,realFile,out]=process.argv.slice(2);
if(!out)throw Error('Usage: summarize-proxy-reuse.mjs local.jsonl real.jsonl report.md');
const load=async file=>{const rows=(await readFile(file,'utf8')).trim().split('\n').map(JSON.parse);if(!rows.some(r=>r.type==='complete'))throw Error('Incomplete benchmark');return rows;};
const quantile=(rows,key,p)=>{const a=rows.map(r=>r[key]).sort((a,b)=>a-b);return a[Math.ceil((a.length-1)*p)];};
const f=n=>Number.isFinite(n)?n.toFixed(2):'—';
const notes=[];
const lines=['# 冷连接与连接复用性能对照','','真实链路：隔离测试客户端 → 原生/GOST 测试网关 → 当前环境已核验的原生出口网关 → 固定上游 → api.ipify.org。未改应用默认内核。','','| 场景 | 内核 | 模式 | 样本 | 失败 | p50 ms | p95 ms | CONNECT p50 ms | TLS p50 ms |','|---|---|---|---:|---:|---:|---:|---:|---:|'];
for(const [label,file] of [['本地 HTTP 64KiB',localFile],['真实 HTTPS JSON',realFile]]){
 const rows=await load(file);
 for(const engine of ['native','gost']){
  for(const mode of ['cold','reuse']){
   const all=rows.filter(r=>r.type==='sample'&&r.engine===engine&&r.mode===mode&&(mode==='cold'||r.iteration>0));const good=all.filter(r=>r.ok);
   lines.push(`| ${label} | ${engine} | ${mode==='cold'?'冷连接':'长连接（排除首次）'} | ${all.length} | ${all.length-good.length} | ${f(quantile(good,'total',.5))} | ${f(quantile(good,'total',.95))} | ${f(quantile(good,'tunnel',.5))} | ${f(quantile(good,'tls',.5))} |`);
  }
  const cold=rows.filter(r=>r.type==='sample'&&r.engine===engine&&r.mode==='cold'&&r.ok),warm=rows.filter(r=>r.type==='sample'&&r.engine===engine&&r.mode==='reuse'&&r.iteration>0&&r.ok);
  const c=quantile(cold,'total',.5),w=quantile(warm,'total',.5);
  notes.push(`\n${label} / ${engine}：后续请求实际复用 ${warm.filter(r=>r.reused).length}/${warm.length}；p50 降低 ${f(c-w)} ms（${f(100*(c-w)/c)}%）。\n`);
 }
 const reconnect=rows.filter(r=>r.type==='reconnect');notes.push(`\n${label}：主动关闭空闲池连接后，${reconnect.length} 个内核均重新建连，reused=${reconnect.map(r=>r.reused).join('/')}。\n`);
}
lines.push('',...notes,'','## 边界与解释','','- 每个内核独立监听端口、令牌和连接池；新连接始终经过该网关的认证 CONNECT，TLS 正常校验证书，每次真实响应均校验固定出口。禁止静默直连。','- 冷连接每次销毁 agent；复用组保留单连接，交替内核和测试模式顺序。首次复用组请求单独保留在 JSONL，不计入后续请求延迟。','- 客户端没有缓存 TLS session。复用收益来自整条现有 CONNECT/TLS 通道，不能只归为 TLS 优化；CONNECT 包含上游建连等时间。','- responseHeaders 是完整响应头到达耗时，不是严格首字节。共用现有出口网关，因此这是连接生命周期对照，不是独立上游下的纯内核排名。','- 本地场景是 HTTP，不能用于推断 TLS 耗时；真实场景是小 JSON 请求，不代表模型推理、下载吞吐或所有目标站点。','- 初始真实试跑使用私网地址，在隔离 bridge 中初始出口验证超时，未绕过验证。改用同一出口网关的 bridge 地址后重跑；失败日志另行保留。','- 没有修改生产代理、账号、默认内核或生产应用；GOST 仍为显式选择。本次短对照不是长时间稳定性保证。');
await writeFile(out,lines.join('\n')+'\n');console.log(out);
