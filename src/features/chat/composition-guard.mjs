const guards = new WeakMap();
const commitKeys = new Set(['Enter', 'Escape']);

// Share one guard between the composer and its capturing suggestion handler.
// It observes IME events without cancelling their native text-editing behavior.
export function mountCompositionGuard(input) {
  if (guards.has(input)) return guards.get(input);
  let composing = false, endedThisTurn = false, timer;
  const heldCommitKeys = new Set(), decisions = new WeakMap();
  const listeners = [];
  const listen = (type, handler) => {
    input.addEventListener(type, handler, true);
    listeners.push([type, handler]);
  };
  const clearEnd = () => {
    clearTimeout(timer);
    endedThisTurn = false;
  };
  const reset = () => {
    clearEnd();
    composing = false;
    heldCommitKeys.clear();
  };
  const isComposing = event => {
    if (!event) return composing;
    if (decisions.has(event)) return decisions.get(event);
    const blocked = Boolean(composing || event.isComposing || event.keyCode === 229 ||
      (commitKeys.has(event.key) && (endedThisTurn || heldCommitKeys.has(event.key))));
    decisions.set(event, blocked);
    if (blocked && commitKeys.has(event.key) && event.type === 'keydown') heldCommitKeys.add(event.key);
    return blocked;
  };
  listen('compositionstart', () => { clearEnd(); composing = true; });
  listen('compositionend', () => {
    composing = false;
    endedThisTurn = true;
    clearTimeout(timer);
    // Some event orders end composition before delivering its confirming key.
    // Guard only this event turn, not a fixed human-visible typing delay.
    timer = setTimeout(() => { endedThisTurn = false; }, 0);
  });
  listen('keydown', isComposing);
  listen('keyup', event => {
    heldCommitKeys.delete(event.key);
    if (commitKeys.has(event.key)) clearEnd();
  });
  listen('pointerdown', clearEnd);
  listen('blur', reset);
  const guard = {
    isComposing,
    reset,
    destroy() {
      reset();
      for (const [type, handler] of listeners) input.removeEventListener(type, handler, true);
      guards.delete(input);
    },
  };
  guards.set(input, guard);
  return guard;
}
