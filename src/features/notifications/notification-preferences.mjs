export const notificationCategories=[
 ['operations','操作反馈','创建、删除、退出账号等操作的结果提示。'],
 ['network','代理与环境','代理连接、断开及环境切换提示。'],
 ['chat','对话与文件','对话同步、模型切换、工作目录和附件提示。'],
 ['runtime','运行时与登录','运行时登录、退出、卸载及检测提示。'],
 ['browser','浏览器','网页加载失败等浏览器提示。'],
 ['errors','操作异常','操作失败和无法完成操作时的弹出提示。']
];
export const notificationDefaults=Object.freeze({inApp:true,desktop:false,...Object.fromEntries(notificationCategories.map(([key])=>[key,true]))});
export function normalizeNotificationPreferences(value){return Object.fromEntries(Object.entries(notificationDefaults).map(([key,fallback])=>[key,typeof value?.[key]==='boolean'?value[key]:fallback]));}
export function notificationStorageKey(owner){return 'kuneco-notifications:v1:'+encodeURIComponent(owner || 'guest');}
export function notificationDelivery(preferences,category='operations'){const p=normalizeNotificationPreferences(preferences),enabled=p[category]===true && notificationCategories.some(([key])=>key===category);return {inApp:enabled&&p.inApp,desktop:enabled&&p.desktop};}
