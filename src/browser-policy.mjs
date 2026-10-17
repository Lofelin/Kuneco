export function installBrowserPolicy() {
  if (globalThis.__workspacePolicyInstalled) return;
  Object.defineProperty(globalThis, '__workspacePolicyInstalled', { value: true });
  // Remove all exposed RTC entry points, including legacy aliases, rather than
  // leaving a replacement constructor that appears to support WebRTC.
  for (const name of Object.getOwnPropertyNames(globalThis).filter(name => /^(?:RTC|webkitRTC)/.test(name)).concat(['RTCPeerConnection','webkitRTCPeerConnection','WebTransport'])) {
    Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false });
  }
  if (globalThis.navigator?.mediaDevices) {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => Promise.reject(new DOMException('Media capture is disabled.', 'NotAllowedError')), configurable: false, writable: false });
  }
  for (const name of ['getUserMedia','webkitGetUserMedia','mozGetUserMedia']) {
    if (globalThis.navigator && name in navigator) Object.defineProperty(navigator, name, { value: (_constraints, _success, fail) => fail?.(new DOMException('Media capture is disabled.', 'NotAllowedError')), configurable: false, writable: false });
  }
  const allowed = new Set(['arial','helvetica','helvetica neue','times','times new roman','courier','courier new','georgia','verdana','tahoma','trebuchet ms','system-ui','serif','sans-serif','monospace','cursive','fantasy','emoji','math','ui-sans-serif','ui-serif','ui-monospace','roboto','inter','open sans']);
  const localAllowed = new Set(allowed);
  const familyName = value => value.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  const registerDeclaredFonts = fonts => { if (fonts?.[Symbol.iterator]) for (const face of fonts) allowed.add(familyName(face.family)); };
  const normalize = families => String(families).split(',').filter(value => (allowed.has(familyName(value)) || /^var\(/i.test(value.trim()))).map(value => value.trim()).join(', ') || 'sans-serif';
  const splitFont = font => /^(.*?(?:\d*\.?\d+)(?:px|pt|em|rem|%|vh|vw)(?:\s*\/\s*[^\s]+)?\s+)(.+)$/i.exec(String(font));
  const normalizeFont = font => { const parts = splitFont(font); return parts ? parts[1] + normalize(parts[2]) : font; };
  for (const Constructor of [globalThis.CanvasRenderingContext2D, globalThis.OffscreenCanvasRenderingContext2D]) {
    if (!Constructor) continue;
    const descriptor = Object.getOwnPropertyDescriptor(Constructor.prototype, 'font');
    if (descriptor?.set) Object.defineProperty(Constructor.prototype, 'font', { ...descriptor, set(value) { descriptor.set.call(this, normalizeFont(value)); } });
  }
  const prototype = globalThis.FontFaceSet?.prototype;
  if (prototype) {
    const check = prototype.check, load = prototype.load;
    const denied = font => { const parts = splitFont(font); return parts && parts[2].split(',').some(value => !allowed.has(familyName(value))); };
    prototype.check = function(font, text) { registerDeclaredFonts(this); return denied(font) ? false : check.call(this, font, text); };
    prototype.load = function(font, text) { registerDeclaredFonts(this); return denied(font) ? Promise.resolve([]) : load.call(this, font, text); };
  }
  if (globalThis.FontFace) {
    const Original = globalThis.FontFace;
    globalThis.FontFace = new Proxy(Original, { construct(target, args, newTarget) {
      const locals = typeof args[1] === 'string' ? [...args[1].matchAll(/local\(\s*(['"]?)(.*?)\1\s*\)/gi)].map(match => match[2]) : [];
      if (locals.some(name => !localAllowed.has(familyName(name)))) throw new DOMException('This local font is not allowed in this browser.', 'NotAllowedError');
      if (typeof args[1] === 'string' && /url\(/i.test(args[1]) && !locals.length) allowed.add(familyName(String(args[0])));
      return Reflect.construct(target, args, newTarget);
    } });
  }
  // Shared workers are not auto-attached by a page-level debugger. Bootstrap them
  // through a same-origin blob; CSP may reject the blob, never fall back to raw code.
  if (globalThis.SharedWorker) {
    const OriginalSharedWorker = globalThis.SharedWorker;
    const bootstrapUrls = new Map();
    globalThis.SharedWorker = new Proxy(OriginalSharedWorker, { construct(target, args, newTarget) {
      const originalUrl = new URL(String(args[0]), location.href).href;
      if (new URL(originalUrl).origin !== location.origin) throw new DOMException('Cross-origin shared workers are not allowed.', 'SecurityError');
      const options = typeof args[1] === 'string' ? { name: args[1] } : { ...args[1] };
      const start = options.type === 'module'
        ? `const connections=[];const hold=e=>{e.stopImmediatePropagation();connections.push(e)};addEventListener('connect',hold);await import(${JSON.stringify(originalUrl)});removeEventListener('connect',hold);for(const e of connections)dispatchEvent(new MessageEvent('connect',{ports:e.ports}));`
        : `const nativeImportScripts=importScripts;globalThis.importScripts=(...urls)=>nativeImportScripts(...urls.map(url=>new URL(url,${JSON.stringify(originalUrl)}).href));importScripts(${JSON.stringify(originalUrl)});`;
      const source = `(${installBrowserPolicy.toString()})();${start}`;
      const key = JSON.stringify([originalUrl, options.type || 'classic', options.credentials || 'same-origin']);
      if (!bootstrapUrls.has(key)) bootstrapUrls.set(key, URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
      return Reflect.construct(target, [bootstrapUrls.get(key), options], newTarget);
    } });
  }
  // CSS font declarations are normalized too; the canvas policy does not merely falsify measurement results.
  if (typeof document === 'undefined') return;
  const cleanStyle = style => {
    // Preserve author font declarations, including unresolved CSS variables and
    // icon-font aliases. Restrict explicit platform-local families without
    // rewriting arbitrary web-font names before their stylesheets have loaded.
    if (style.fontFamily && /pingfang|hiragino|stheiti|stsong|simsun|microsoft yahei|arial unicode/i.test(style.fontFamily)) {
      const normalized=normalize(style.fontFamily);if(style.fontFamily!==normalized)style.setProperty('font-family',normalized,style.getPropertyPriority('font-family'));
    }
    if (style.src && /local\(/i.test(style.src)) style.setProperty('src', style.src.replace(/local\([^)]*\)/gi, 'local("__workspace_unavailable_font__")'));
  };
  const registerWebFonts = rules => { for (const rule of rules) { if (rule.type === 5 && /url\(/i.test(rule.style.getPropertyValue?.('src') || rule.style.src || '')) allowed.add(familyName(rule.style.fontFamily)); if (rule.cssRules) registerWebFonts(rule.cssRules); } };
  const cleanRules = rules => { for (const rule of rules) { if (rule.style) { if (rule.type === 5) { const src=rule.style.getPropertyValue?.('src') || rule.style.src || '';if (/local\(/i.test(src)) rule.style.setProperty('src',src.replace(/local\([^)]*\)/gi,'local("__workspace_unavailable_font__")')); } else cleanStyle(rule.style); } if (rule.cssRules) cleanRules(rule.cssRules); } };
  const clean = () => {
    registerDeclaredFonts(document.fonts);
    for (const sheet of document.styleSheets) { try { registerWebFonts(sheet.cssRules); } catch {} }
    for (const sheet of document.styleSheets) { try { cleanRules(sheet.cssRules); } catch {} }
    for (const element of document.querySelectorAll('[style]')) cleanStyle(element.style);
  };
  document.addEventListener('DOMContentLoaded', clean);
  document.addEventListener('load', event => { if (event.target?.tagName === 'LINK') clean(); }, true);
  new MutationObserver(clean).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
}
export const POLICY_SOURCE = `(${installBrowserPolicy.toString()})()`;
export const FONT_CSS = 'html { font-family: Arial, Helvetica, sans-serif; }';

export async function protectBrowserContents(wc, onFailure, { initializeBlank = true } = {}) {
  if (initializeBlank) await wc.loadURL('about:blank');
  const debuggerApi = wc.debugger;
  debuggerApi.attach('1.3');
  const send = async (method, params = {}, id) => {
    const result = await debuggerApi.sendCommand(method, params, id);
    return result;
  };
  const initialize = async (type, id) => {
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{type:'service_worker',exclude:true},{}] }, id);
    if (type === 'page' || type === 'iframe') {
      await send('Page.enable', {}, id);
      await send('Page.addScriptToEvaluateOnNewDocument', { source: POLICY_SOURCE, runImmediately: false }, id);
      await send('DOM.enable', {}, id);
      await send('CSS.enable', {}, id);
    } else {
      await send('Runtime.enable', {}, id);
      const result = await send('Runtime.evaluate', { expression: POLICY_SOURCE }, id);
      if (result.exceptionDetails) throw new Error('Worker privacy policy failed');
    }
  };
  const bounded = async task => {
    let timer;
    try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Privacy initialization timed out')), 8000); })]); }
    finally { clearTimeout(timer); }
  };
  const pending = new Set();
  debuggerApi.on('message', (_event, method, params, parentId) => {
    if (method === 'Target.attachedToTarget') {
      const id = params.sessionId;
      const task = bounded(initialize(params.targetInfo.type, id)).then(() => send('Runtime.runIfWaitingForDebugger', {}, id)).catch(() => {
        // Do not resume an unprotected target.
        if (!wc.isDestroyed()) onFailure();
      }).finally(() => pending.delete(task));
      pending.add(task);
    }
    if (method === 'Page.frameNavigated') {
      void send('CSS.createStyleSheet', { frameId: params.frame.id }, parentId)
        .then(({ styleSheetId }) => send('CSS.setStyleSheetText', { styleSheetId, text: FONT_CSS }, parentId))
        .catch(() => {}); // The user-origin preload stylesheet protects the top frame too.
    }
  });
  debuggerApi.on('detach', (_event, reason) => {
    if (!wc.isDestroyed() && !['target_closed', 'target closed'].includes(reason)) onFailure();
  });
  await bounded(initialize('page'));
}
