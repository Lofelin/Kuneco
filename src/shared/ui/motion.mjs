export const reducedMotion=()=>globalThis.document?.documentElement.dataset.reducedMotion==='true'||Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
