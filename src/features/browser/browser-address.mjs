export const SEARCH_HOME = 'https://www.google.com/?hl=en';

export function resolveBrowserAddress(input) {
  const value = String(input).trim();
  if (!value) return SEARCH_HOME;
  // Keep explicit schemes for the main process to validate before navigation.
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[^\s/:]+:\d+(?:[/?#]|$)/.test(value)) return value;
  if (!/\s/.test(value)) {
    try {
      const url = new URL(`https://${value}`);
      if (url.hostname.includes('.') || url.hostname.startsWith('[') || url.hostname === 'localhost') return url.href;
    } catch {}
  }
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', value);
  url.searchParams.set('hl', 'en');
  return url.href;
}

// Only the internal empty page bypasses ordinary web address validation.
export function validateBrowserNavigationURL(raw){
 const value=String(raw).trim();if(value==='about:blank')return value;
 let url;try{url=new URL(value.includes('://')?value:`https://${value}`);}catch{throw Error('网址无效，请检查后重试。');}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('仅支持普通 HTTP／HTTPS 页面');
 if(url.hostname.toLowerCase().replace(/^\[|\]$/g,'')==='0.0.0.0')throw Error('请使用具体的本地服务地址');return url.href;
}
