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
