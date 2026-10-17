export const CONTENT_TAB_LIMIT = 10;
export function openContentTab(state, tab) {
  const existing = state.tabs.find(item => item.id === tab.id);
  if (!existing && state.tabs.length >= CONTENT_TAB_LIMIT) throw new Error('最多打开 10 个标签，请先关闭一个标签。');
  return { tabs: existing ? state.tabs.map(item => item.id === tab.id ? {...item, ...tab} : item) : [...state.tabs, tab], activeId: tab.id };
}
export function closeContentTab(state, id) {
  const index = state.tabs.findIndex(item => item.id === id);
  if (index < 0 || state.tabs.length <= 1) return state;
  const tabs = state.tabs.filter(item => item.id !== id);
  return { tabs, activeId: state.activeId === id ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null : state.activeId };
}
