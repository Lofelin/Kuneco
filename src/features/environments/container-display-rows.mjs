import {formatDisplayDate} from '../../shared/date-format.mjs';
export function containerDisplayRows(worker,gateway,{external=false}={}){
 const cell=(data,render)=>data?.available?render(data):'暂不可读取';
 const health=d=>({healthy:'正常',starting:'检查中',unhealthy:'异常'}[d.health] || (d.health?'未知':'未配置'));
 const memory=n=>n>0?(n>=1073741824?+(n/1073741824).toFixed(1)+' GiB':+(n/1048576).toFixed(1)+' MiB'):'未设置上限';
 const specs=[['运行状态',d=>d.status],['服务健康',health],['资源上限',d=>`${d.cpus>0?d.cpus/1e9+' CPU':'CPU 未限额'} · ${memory(d.memory)} · ${d.pids>0?d.pids+' 个进程':'进程数未限额'}`],['进程回收',d=>d.init?'已启用':'未启用'],['根目录',d=>d.readonly?'只读':'可写'],['日志保留',d=>d.logMaxSize&&d.logMaxFiles?`${d.logMaxSize} / 文件 · 保留 ${d.logMaxFiles} 个（${d.logDriver}）`:d.logDriver?`${d.logDriver} · 未设置容器级轮转`:'暂不可读取'],...(!external?[['规格管理',d=>d.specManaged?'已纳入，启动时检查更新':'旧规格，下次启动时更新']]:[])];
 return specs.map(([label,render])=>({label,worker:cell(worker,render),gateway:cell(gateway,render)}));
}

export function networkDisplayRows(data,{external=false}={}){
 if(external)return [{label:'网络管理',value:'由原容器管理方维护，未验证 Kuneco 防火墙隔离'}];
 if(!data?.available)return [{label:'网络检查',value:'暂不可读取，不能确认隔离状态'}];
 return [
  {label:'防火墙核验',value:data.verified?'规则完整 · IPv4 / IPv6 默认拒绝':data.running?'未通过，请重新启动环境或检查配置':'容器已停止，未检查运行时规则'},
  {label:'代理任务出口',value:data.verified?'仅允许当前环境网关，不能回退直连':'隔离状态未确认'},
  {label:'环境网络',value:data.internal&&!data.bridge?'内部私有网络 · 未接入直连网络':'网络配置需要检查'},
  {label:'DNS 防绕过',value:data.verified?'在地址转换前拦截直连 DNS':'未确认'},
  {label:'显式直连',value:`独立执行容器 · 当前 ${data.directTasks} 个任务`},
  {label:'共享数据',value:'同环境共享工作文件和登录数据；网络、进程和临时目录分离'}
 ];
}

// Only safe inspection metadata is shown; raw health-check output stays private.
export function renderContainerHealth(doc,data,label){
 if(!data?.available || data.health!=='unhealthy')return label;
 const wrapper=doc.createElement('div'),toggle=doc.createElement('app-button'),details=doc.createElement('div');
 toggle.setAttribute('appearance','plain');toggle.setAttribute('size','s');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','异常：展开服务健康详情');
 const icon=doc.createElement('wa-icon');icon.setAttribute('src','assets/icons/chevron-down.svg');icon.setAttribute('aria-hidden','true');icon.slot='start';toggle.append(icon,doc.createTextNode('异常'));
 details.hidden=true;details.className='settings-section-description';
 const reason=doc.createElement('p'),checked=doc.createElement('p');
 reason.textContent=Number.isInteger(data.healthExitCode)?`健康检查未通过，最近检查退出码：${data.healthExitCode}。`:'健康检查未通过，未提供失败详情。';
 checked.textContent=data.healthCheckedAt?`最近检查：${formatDisplayDate(data.healthCheckedAt,'zh-CN','datetime',{timeDisplay:'absolute'})}`:'最近检查时间未提供。';
 details.append(reason,checked);toggle.addEventListener('click',()=>{details.hidden=!details.hidden;toggle.setAttribute('aria-expanded',String(!details.hidden));toggle.setAttribute('aria-label',details.hidden?'异常：展开服务健康详情':'异常：收起服务健康详情');});
 wrapper.append(toggle,details);return wrapper;
}
