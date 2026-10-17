export function containerDisplayRows(worker,gateway,{external=false}={}){
 const cell=(data,render)=>data?.available?render(data):'暂不可读取';
 const health=d=>({healthy:'正常',starting:'初始化中',unhealthy:'自检失败'}[d.health] || '未配置');
 const memory=n=>n>0?(n>=1073741824?+(n/1073741824).toFixed(1)+' GiB':+(n/1048576).toFixed(1)+' MiB'):'未设置上限';
 const specs=[['运行状态',d=>d.status],['容器自检',health],['资源上限',d=>`${d.cpus>0?d.cpus/1e9+' CPU':'CPU 未限额'} · ${memory(d.memory)} · ${d.pids>0?d.pids+' 个进程':'进程数未限额'}`],['进程回收',d=>d.init?'已启用':'未启用'],['根目录',d=>d.readonly?'只读':'可写'],['日志保留',d=>d.logMaxSize&&d.logMaxFiles?`${d.logMaxSize} / 文件 · 保留 ${d.logMaxFiles} 个（${d.logDriver}）`:d.logDriver?`${d.logDriver} · 未设置容器级轮转`:'暂不可读取'],...(!external?[['规格管理',d=>d.specManaged?'已纳入，启动时检查更新':'旧规格，下次启动时更新']]:[])];
 return specs.map(([label,render])=>({label,worker:cell(worker,render),gateway:cell(gateway,render)}));
}
