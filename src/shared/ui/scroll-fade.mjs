const mounted = new WeakMap();

export function scrollFadeEdges({position, extent, viewport, size = 24}) {
  const overflow = Math.max(0, extent - viewport);
  const offset = Math.max(0, Math.min(overflow, Math.abs(position)));
  // scrollHeight/clientHeight round to integers while scroll offsets can be fractional.
  return {start: offset <= 1 ? 0 : Math.min(size, offset), end: overflow - offset <= 1 ? 0 : Math.min(size, overflow - offset)};
}

/** Decorate an existing scroller without changing its content, layout or input handling. */
export function mountScrollFade(element, {axis = 'vertical', size = 24} = {}) {
  if (mounted.has(element)) return mounted.get(element);
  const win = element.ownerDocument.defaultView;
  let frame = null;
  const children = new Set();
  const horizontal = axis === 'horizontal';
  const update = () => {
    frame = null;
    const edges = scrollFadeEdges({
      position: horizontal ? element.scrollLeft : element.scrollTop,
      extent: horizontal ? element.scrollWidth : element.scrollHeight,
      viewport: horizontal ? element.clientWidth : element.clientHeight, size,
    });
    // Hidden panels have no meaningful viewport until ResizeObserver reports their reveal.
    const visible = horizontal ? element.clientWidth : element.clientHeight;
    element.style.setProperty('--scroll-fade-start', `${visible ? edges.start : 0}px`);
    element.style.setProperty('--scroll-fade-end', `${visible ? edges.end : 0}px`);
  };
  const schedule = () => { if (frame === null) frame = win.requestAnimationFrame(update); };
  const resize = win.ResizeObserver ? new win.ResizeObserver(schedule) : null;
  const observeChildren = () => {
    for (const child of children) if (child.parentElement !== element) { resize?.unobserve(child); children.delete(child); }
    for (const child of element.children) if (!children.has(child)) { children.add(child); resize?.observe(child); }
    schedule();
  };
  const mutation = new win.MutationObserver(observeChildren);
  element.dataset.scrollFade = axis;
  element.addEventListener('scroll', schedule, {passive: true});
  win.addEventListener('resize', schedule);
  resize?.observe(element);
  mutation.observe(element, {childList: true, subtree: true, characterData: true});
  observeChildren();
  const controller = {refresh: schedule, destroy() {
    if (frame !== null) win.cancelAnimationFrame(frame);
    resize?.disconnect(); mutation.disconnect();
    element.removeEventListener('scroll', schedule); win.removeEventListener('resize', schedule);
    delete element.dataset.scrollFade;
    element.style.removeProperty('--scroll-fade-start'); element.style.removeProperty('--scroll-fade-end');
    mounted.delete(element);
  }};
  mounted.set(element, controller);
  return controller;
}
