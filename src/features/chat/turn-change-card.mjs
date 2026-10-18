const rendered = new WeakMap();
let descriptionSequence = 0;
const knownCount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isInteger(value);

/** Render a turn's recorded edits. Review/undo are delegated to the owning conversation. */
export function renderTurnChangeCard(host, turn, {onReview, onUndo, running = false, undoState = {}} = {}) {
 const doc = host.ownerDocument;
 const prior = rendered.get(host);
 const state = prior?.id === turn.id ? prior : {id: turn.id, expanded: false};
 rendered.set(host, state);
 host.classList.add('turn-change-card');
 host.dataset.turnId = String(turn.id);
 const files = Array.isArray(turn.files) ? turn.files : [];
 const make = (tag, className, text) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
 };
 const icon = (name, slot) => {
  const node = make('wa-icon');node.setAttribute('src', 'assets/icons/' + name + '.svg');node.setAttribute('aria-hidden', 'true');
  if (slot) node.slot = slot;
  return node;
 };
 const totals = (added, removed) => {
  const group = make('span', 'turn-change-counts');
  for (const [value, prefix, className, label] of [[added, '+', 'added', '新增'], [removed, '−', 'removed', '删除']]) {
   const count = make('span', 'turn-change-' + className, prefix + (knownCount(value) ? value : '?'));
   count.setAttribute('aria-label', label + (knownCount(value) ? value + ' 行' : '行数未知'));
   group.append(count);
  }
  return group;
 };
 const action = (label, iconName, callback) => {
  const button = make('app-button', 'content-action');button.setAttribute('appearance', 'plain');button.type = 'button';
  button.append(icon(iconName, 'start'), doc.createTextNode(label));
  button.addEventListener('click', () => {if (!button.disabled && !button.loading) callback?.();});
  return button;
 };
 const heading = make('div', 'turn-change-heading');
 const summary = make('div', 'turn-change-summary');
 summary.append(icon('file-diff'), make('span', 'turn-change-title', '已编辑 ' + files.length + ' 个文件'), totals(turn.added, turn.removed));
 const toolbar = make('div', 'turn-change-actions');
 const reverted = Boolean(turn.undo?.revertedAt || undoState.revertedAt || undoState.reverted);
 const pending = Boolean(undoState.pending);
 const undo = action(reverted ? '已撤销' : pending ? '撤销中' : '撤销', 'undo-2', onUndo);
 undo.dataset.action = 'undo';
 undo.disabled = !turn.undo?.available || Boolean(running) || pending || reverted || typeof onUndo !== 'function';
 undo.loading = pending;
 const reason = reverted ? '此回合的变更已撤销。' : pending ? '正在撤销此回合的变更。' : running ? '回合运行中，完成后可撤销。' : !turn.undo?.available ? (turn.undo?.reason || '此回合暂不支持撤销。') : typeof onUndo !== 'function' ? '当前视图不支持撤销。' : '撤销此回合记录的文件变更。';
 undo.title = reason;
 const description = make('span', 'turn-change-undo-description', reason);
 description.id = 'turn-change-undo-' + (++descriptionSequence);
 undo.setAttribute('aria-describedby', description.id);
 const review = action('查看变更', 'file-diff', () => onReview?.());
 review.dataset.action = 'review';review.disabled = typeof onReview !== 'function' || files.length === 0;
 toolbar.append(undo, review);heading.append(summary, toolbar);
 const list = make('ul', 'turn-change-files');
 list.setAttribute('aria-label', '此回合修改的文件');
 const renderFiles = () => {
  list.replaceChildren();
  for (const file of files.slice(0, state.expanded ? files.length : 3)) {
   const row = make('li');
   const button = make('app-button', 'turn-change-file');button.setAttribute('layout', 'custom');button.setAttribute('appearance', 'plain');button.type = 'button';
   const path = String(file.path ?? '');
   button.title = path;button.setAttribute('aria-label', '查看文件变更：' + path);button.disabled = typeof onReview !== 'function';
   const counts = totals(file.added, file.removed);counts.slot = 'end';
   button.append(icon('file-diff', 'start'), make('span', 'turn-change-path', path), counts);
   button.addEventListener('click', () => {if (!button.disabled) onReview?.(path);});
   row.append(button);list.append(row);
  }
 };
 renderFiles();host.replaceChildren(heading, description, list);
 if (files.length > 3) {
  const expand = action('', 'chevron-down');expand.classList.add('turn-change-expand');
  const label = doc.createTextNode('');expand.append(label);
  const updateExpansion = () => {
   label.textContent = state.expanded ? '收起文件' : '再显示 ' + (files.length - 3) + ' 个文件';
   expand.setAttribute('aria-expanded', String(state.expanded));expand.querySelector('wa-icon').setAttribute('src', 'assets/icons/chevron-' + (state.expanded ? 'up' : 'down') + '.svg');
  };
  expand.addEventListener('click', () => {state.expanded = !state.expanded;renderFiles();updateExpansion();});
  updateExpansion();host.append(expand);
 }
 const backups=undoState.backups||turn.undo?.backups;
 if(backups?.length){const note=make('p','turn-change-backups','恢复备份：'+backups.map(entry=>entry.path+' → '+entry.backup).join('；'));host.append(note);}
 if (undoState.error) {
  const error = make('p', 'turn-change-error', String(undoState.error));error.setAttribute('role', 'status');host.append(error);
 }
 return host;
}
