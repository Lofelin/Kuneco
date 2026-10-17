import {inspectContainer} from './container-reliability.mjs';
// Never infer absence from a failed inspect or remove another task's container.
export async function cleanupDirectTask(manager,name,prefix){
 let container;
 try{container=await inspectContainer(manager,name);}catch{
  // Docker creation/removal can complete between inspect and the confirming name listing.
  // Re-read once; persistent inspection/daemon failures still abort cleanup.
  container=await inspectContainer(manager,name);
 }
 if(!container)return false;
 if(!container.Id || container.Config?.Labels?.app!=='dingtu-direct' || container.Config?.Labels?.['io.kuneco.environment']!==prefix)throw new Error('直连任务归属不匹配，已保留');
 const exists=async()=>Boolean((await manager.command(['ps','-aq','--filter','id='+container.Id])).trim());
 try{await manager.command(['stop','-t','3',container.Id]);}catch(error){if(await exists())throw error;return true;}
 try{await manager.command(['rm','-f',container.Id]);}catch(error){if(await exists())throw error;}
 if(await exists())throw new Error('直连任务尚未清理，已取消环境切换');
 return true;
}
