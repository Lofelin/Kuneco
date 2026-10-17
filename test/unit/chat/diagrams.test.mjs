import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {adoptCodeBlocks} from '../../../src/features/chat/code-blocks.mjs';
import {adoptChatDiagrams, sanitizeDiagramSVG, validateDiagramSource} from '../../../src/features/chat/diagrams.mjs';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40"><text x="10" y="20">Start → End</text></svg>';
function setup(source = 'graph LR\n A-->B') {
  const dom = new JSDOM('<main><pre><code class="language-mermaid"></code></pre></main>');
  const root = dom.window.document.querySelector('main');root.querySelector('code').textContent = source;adoptCodeBlocks(root);return {doc: dom.window.document, root};
}
test('diagram renderer keeps source intact and exports the sanitized SVG', async () => {
  const {root} = setup(), saves = [];
  await adoptChatDiagrams(root, {debounceMs: 0, renderSVG: async source => {assert.equal(source, 'graph LR\n A-->B');return svg;}, saveSVG: source => saves.push(source)});
  assert.equal(root.querySelector('.chat-diagram').dataset.diagramState, 'complete');
  assert.equal(root.querySelector('pre').hidden, true);
  root.querySelector('[aria-label="查看图表源码"]').click();assert.equal(root.querySelector('pre').hidden, false);
  assert.equal(root.querySelector('code').textContent, 'graph LR\n A-->B');
  [...root.querySelectorAll('app-button')].find(node => node.textContent === '导出 SVG').click();
  assert.match(saves[0], /Start → End/);assert.equal(root.querySelector('button'), null);
});
test('failed parser remains visibly failed with source and no export', async () => {
  const {root} = setup();await adoptChatDiagrams(root, {debounceMs: 0, renderSVG: async () => {throw new Error('Parse error');}});
  assert.equal(root.querySelector('.chat-diagram').dataset.diagramState, 'failed');assert.match(root.querySelector('.chat-diagram-status').textContent, /Parse error/);
  assert.equal([...root.querySelectorAll('app-button')].find(node => node.textContent === '导出 SVG').disabled, true);
  root.querySelector('[aria-label="查看图表源码"]').click();assert.equal(root.querySelector('pre').hidden, false);
});
test('stale rendering cannot replace a newer streamed diagram or reset manual source mode', async () => {
  const {root} = setup();let finish;
  const first = adoptChatDiagrams(root, {debounceMs: 0, renderSVG: () => new Promise(resolve => {finish = resolve;})});
  await new Promise(resolve => setTimeout(resolve, 5));root.querySelector('[aria-label="查看图表源码"]').click();
  root.querySelector('code').textContent += '\n B-->C';
  await adoptChatDiagrams(root, {debounceMs: 0, renderSVG: async () => svg.replace('Start → End', 'New')});finish(svg);await first;
  assert.match(decodeURIComponent(root.querySelector('img').src), /New/);assert.equal(root.querySelector('pre').hidden, false);
});
test('offline policy rejects renderer reconfiguration and external resources before rendering', () => {
  for (const source of ['%%{init: {securityLevel: "loose"}}%%\ngraph LR\nA-->B', '---\nconfig: {}\n---\ngraph LR', 'graph LR\nA@{img: "remote.svg"}', 'graph LR\n A[https://evil.invalid]']) assert.throws(() => validateDiagramSource(source), /离线/);
  assert.equal(validateDiagramSource('sequenceDiagram\n Alice->>Bob: Hello'), 'sequenceDiagram\n Alice->>Bob: Hello');
});
test('SVG output strips executable content, links, foreign HTML and resource references', () => {
  const {doc} = setup();const result = sanitizeDiagramSVG('<svg xmlns="http://www.w3.org/2000/svg" onload="evil()"><script>evil()</script><foreignObject><div>html</div></foreignObject><image href="https://evil.invalid/a"/><style>@import "https://evil.invalid/css";</style><rect fill="url(https://evil.invalid/x)"/><text onclick="evil()">safe</text><animate attributeName="href" values="javascript:evil()"/></svg>', doc);
  assert.doesNotMatch(result, /evil|foreignObject|<image|<script|<animate|onload|onclick|@import/);assert.match(result, />safe</);
});

test('safe generated keyframe styles remain so labels and nodes retain contrast',()=>{
 const doc=new JSDOM('').window.document;
 const svg=sanitizeDiagramSVG('<svg><style>@keyframes dash{to{stroke-dashoffset:0}}.node{fill:#eee;stroke:#888}text{fill:#222}</style><rect class="node"/><text>Readable</text></svg>',doc);
 assert.match(svg,/@keyframes dash/);assert.match(svg,/fill:#eee/);
});
