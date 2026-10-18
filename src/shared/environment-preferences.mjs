export const environmentDefaults=Object.freeze({environmentLogAutoClean:true,environmentLogRetentionDays:7,environmentHealthDebug:true,environmentHealthInterval:3});
export function normalizeEnvironmentPreferences(value={}){
 const out={...environmentDefaults};
 for(const key of ['environmentLogAutoClean','environmentHealthDebug'])if(typeof value[key]==='boolean')out[key]=value[key];
 for(const [key,allowed] of Object.entries({environmentLogRetentionDays:[1,7,30,90],environmentHealthInterval:[3,10,30]}))if(allowed.includes(value[key]))out[key]=value[key];
 return out;
}
