// Localize display names without replacing IPinfo's geographic result.
const regions = {US:{'New York':'纽约州','District of Columbia':'哥伦比亚特区','Washington':'华盛顿州','California':'加利福尼亚州','Texas':'得克萨斯州','Florida':'佛罗里达州','Illinois':'伊利诺伊州','Massachusetts':'马萨诸塞州','New Jersey':'新泽西州','Virginia':'弗吉尼亚州','Oregon':'俄勒冈州','Nevada':'内华达州','Colorado':'科罗拉多州','Georgia':'佐治亚州','Arizona':'亚利桑那州','Pennsylvania':'宾夕法尼亚州'}};
const cities = {US:{'New York City':'纽约市','New York':'纽约市','Washington':'华盛顿','Los Angeles':'洛杉矶','San Francisco':'旧金山','San Jose':'圣何塞','Seattle':'西雅图','Chicago':'芝加哥','Boston':'波士顿','Miami':'迈阿密','Dallas':'达拉斯','Houston':'休斯敦','Atlanta':'亚特兰大','Las Vegas':'拉斯维加斯','San Diego':'圣迭戈','Denver':'丹佛','Phoenix':'菲尼克斯','Philadelphia':'费城'},JP:{Tokyo:'东京',Osaka:'大阪'},GB:{London:'伦敦'},SG:{Singapore:'新加坡'},HK:{'Hong Kong':'香港'},CN:{Beijing:'北京',Shanghai:'上海',Guangzhou:'广州',Shenzhen:'深圳'},DE:{Frankfurt:'法兰克福',Berlin:'柏林'},FR:{Paris:'巴黎'},CA:{Toronto:'多伦多',Vancouver:'温哥华'},AU:{Sydney:'悉尼',Melbourne:'墨尔本'}};
export function formatProxyLocation(status,locale='zh-CN'){
 const code=/^[A-Z]{2}$/.test(status.countryCode || '')?status.countryCode:null;
 let country=locale==='en-US'?'Unknown location':'地区未知';
 if(code){try{country=new Intl.DisplayNames([locale],{type:'region'}).of(code)||code;}catch{country=code;}}
 let city=status.city,region=status.region;
 if(locale==='zh-CN'){
  city=cities[code]?.[city] || city;
  region=regions[code]?.[region] || cities[code]?.[region] || region;
 }
 return {country,text:[city,region,country].filter((value,index,all)=>value && all.indexOf(value)===index).join(' · ')};
}
