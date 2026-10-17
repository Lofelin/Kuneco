import createDOMPurify from 'dompurify';

let enginePromise, sequence = 0;
const states = new WeakMap();
const MAX_SOURCE = 50000;
export function validateDiagramSource(source) {
  if (source.length > MAX_SOURCE) throw new Error('图表源码过长，请缩小图表');
  // Model output cannot weaken renderer policy or load resources in the render phase.
  if (/^\s*---|%%\s*\{|(?:https?:|file:|data:|javascript:|\/\/)|<\s*(?:img|image|iframe|script|style)\b|\burl\s*\(|@import|\b(?:img|image)\s*:/im.test(source)) {
    throw new Error('离线图表不支持自定义配置、外部资源或嵌入图片');
  }
  return source;
}

export function sanitizeDiagramSVG(svg, doc) {
  const purify = createDOMPurify(doc.defaultView);
  const clean = purify.sanitize(svg, {
    USE_PROFILES: {svg: true, svgFilters: true},
    FORBID_TAGS: ['foreignObject', 'script', 'image', 'a', 'animate', 'animateMotion', 'animateTransform', 'set'],
    FORBID_ATTR: ['href', 'xlink:href', 'target'],
    RETURN_DOM_FRAGMENT: true,
  });
  const root = clean.querySelector('svg');
  if (!root) throw new Error('图表未生成有效 SVG');
  for (const element of [root, ...root.querySelectorAll('*')]) {
    // SVG presentation attributes may contain CSS references too.
    for (const attr of [...element.attributes]) {
      if (/url\s*\(/i.test(attr.value) && !/^(?:url\(\s*['"]?#[\w:.-]+['"]?\s*\))$/i.test(attr.value)) element.removeAttribute(attr.name);
    }
    if (element.localName === 'style') {
      const css = element.textContent;
      if (/@import|@font-face|\\|(?:https?:|data:|file:)|url\s*\(\s*['"]?(?!#)/i.test(css)) element.remove();
    }
  }
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new doc.defaultView.XMLSerializer().serializeToString(root);
}

async function renderLocally(source) {
  enginePromise ||= import('mermaid').then(({default: mermaid}) => {
    mermaid.initialize({startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
      htmlLabels: false, flowchart: {htmlLabels: false}, fontFamily: 'Arial, sans-serif',
      maxTextSize: MAX_SOURCE, maxEdges: 500});
    return mermaid;
  });
  const mermaid = await enginePromise;
  const {svg} = await mermaid.render(`kuneco-diagram-${++sequence}`, source);
  return svg;
}

function action(doc, label, icon) {
  const button = doc.createElement('app-button');
  button.setAttribute('type', 'button');button.setAttribute('appearance', 'plain');
  button.className = 'content-action chat-diagram-action';
  const glyph = doc.createElement('wa-icon');glyph.setAttribute('slot', 'start');glyph.setAttribute('src', `assets/icons/${icon}.svg`);
  button.append(glyph, doc.createTextNode(label));return button;
}
function saveSVG(svg, doc) {
  const url = doc.defaultView.URL.createObjectURL(new doc.defaultView.Blob([svg], {type: 'image/svg+xml'}));
  const link = doc.createElement('a');link.href = url;link.download = 'diagram.svg';link.click();
  doc.defaultView.setTimeout(() => doc.defaultView.URL.revokeObjectURL(url), 1000);
}
function createState(block, options) {
  const doc = block.ownerDocument, pre = block.querySelector('pre'), toolbar = block.querySelector('.chat-code-toolbar');
  const preview = doc.createElement('div');preview.className = 'chat-diagram-preview';
  const status = doc.createElement('p');status.className = 'chat-diagram-status';status.setAttribute('role', 'status');status.setAttribute('aria-live', 'polite');
  const toggle = action(doc, '查看源码', 'code'), download = action(doc, '导出 SVG', 'download');
  toggle.setAttribute('aria-label', '查看图表源码');toggle.setAttribute('aria-pressed', 'false');
  download.disabled = true;toolbar.append(toggle, download);block.append(status, preview);block.classList.add('chat-diagram');
  const state = {block, pre, preview, status, toggle, download, source: null, svg: null, version: 0, showSource: false, options};
  const show = () => {
    pre.hidden = !state.showSource;preview.hidden = state.showSource;
    toggle.lastChild.textContent = state.showSource ? '查看图表' : '查看源码';
    toggle.setAttribute('aria-label', state.showSource ? '查看图表预览' : '查看图表源码');
    toggle.setAttribute('aria-pressed', String(state.showSource));
  };
  state.show = show;
  toggle.addEventListener('click', () => {state.showSource = !state.showSource;show();});
  download.addEventListener('click', () => {
    if (!state.svg) return;
    try {(state.options.saveSVG || saveSVG)(state.svg, doc);} catch {status.textContent = '导出失败，请重试';}
  });
  show();return state;
}

/** Call after adoptCodeBlocks; code-block reuse preserves manual source/preview choice. */
export function adoptChatDiagrams(root, options = {}) {
  const promises = [];
  for (const block of root.querySelectorAll('.chat-code-block[data-language="mermaid"]')) {
    let state = states.get(block);
    if (!state) {state = createState(block, options);states.set(block, state);}
    const source = block.querySelector('pre > code').textContent;
    if (state.source === source) continue;
    state.source = source;state.svg = null;state.download.disabled = true;state.preview.replaceChildren();
    state.status.textContent = '正在绘制图表…';state.block.dataset.diagramState = 'rendering';
    const version = ++state.version;
    const task = new Promise(resolve => setTimeout(resolve, options.debounceMs ?? 200)).then(async () => {
      if (state.version !== version) return;
      try {
        validateDiagramSource(source);
        const raw = await (options.renderSVG || renderLocally)(source);
        if (state.version !== version) return;
        const svg = sanitizeDiagramSVG(raw, block.ownerDocument);
        const image = block.ownerDocument.createElement('img');image.alt = 'Mermaid 图表';image.draggable = false;
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        state.svg = svg;state.preview.replaceChildren(image);state.download.disabled = false;
        state.status.textContent = '';state.block.dataset.diagramState = 'complete';state.show();
      } catch (error) {
        if (state.version !== version) return;
        state.status.textContent = `图表暂时无法绘制：${String(error?.message || error).slice(0, 240)}。可查看源码。`;
        state.block.dataset.diagramState = 'failed';
      }
    });
    promises.push(task);
  }
  return Promise.all(promises);
}
