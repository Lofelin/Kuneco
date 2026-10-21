export const memoryDefaults=Object.freeze({automatic:true,recall:true,limit:8,budget:6000});
export function memoryPreferences(value={}){return {automatic:value.automatic!==false,recall:value.recall!==false,limit:[4,8,12].includes(value.limit)?value.limit:8,budget:[3000,6000,12000].includes(value.budget)?value.budget:6000};}
export function memoryPreferencePatch(value){
 const patch={};for(const key of ['automatic','recall'])if(value[key]!==undefined){if(typeof value[key]!=='boolean')throw Error('无效的记忆开关');patch[key]=value[key];}
 for(const [key,allowed] of [['limit',[4,8,12]],['budget',[3000,6000,12000]]])if(value[key]!==undefined){if(!allowed.includes(value[key]))throw Error('无效的召回设置');patch[key]=value[key];}
 if(!Object.keys(patch).length)throw Error('没有可保存的记忆设置');return patch;
}
