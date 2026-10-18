import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_BROWSER_SETTINGS = Object.freeze({ restoreTabs: false, downloadPath: '', askDownload: true, showFullUrl: true, webLinks: 'internal', localLinks: 'internal', agentEnabled: true, historyAccess: 'allow', siteTools: false, annotationScreenshots: 'ask', zoomByOrigin: {} });
const queues = new Map();
const collections = ['history', 'bookmarks', 'downloads', 'permissions', 'agentRules', 'extensions', 'tabs'];
const values = ['ask', 'allow', 'block'];
const text = (v, name, max = 4096) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`Invalid ${name}`); return v.trim(); };
const url = value => { const u = new URL(text(value, 'URL', 16384)); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Only HTTP(S) URLs without credentials are supported'); return u.href; };
const origin = value => new URL(url(value)).origin;
const clone = value => structuredClone(value);
const blank = () => ({ version: 1, permissionDefaultsVersion: 2, settings: clone(DEFAULT_BROWSER_SETTINGS), ...Object.fromEntries(collections.map(k => [k, []])), vault: null });
export function validateSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid settings');
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULT_BROWSER_SETTINGS, key)) throw new Error(`Unknown setting: ${key}`);
    if (typeof DEFAULT_BROWSER_SETTINGS[key] === 'boolean' && typeof value !== 'boolean') throw new Error(`Invalid setting: ${key}`);
    if (key === 'downloadPath' && (typeof value !== 'string' || value.includes('\0') || (value && !path.isAbsolute(value)))) throw new Error('Invalid download path');
    if (['webLinks', 'localLinks'].includes(key) && !['internal', 'external'].includes(value)) throw new Error(`Invalid setting: ${key}`);
    if (key === 'historyAccess' && !values.includes(value)) throw new Error(`Invalid setting: ${key}`);
    if (key === 'annotationScreenshots' && !['always', 'ask', 'never'].includes(value)) throw new Error('Invalid screenshot setting');
    if (key === 'zoomByOrigin') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 2000) throw new Error('Invalid zoom settings');
      for (const [site, factor] of Object.entries(value)) if (origin(site) !== site || typeof factor !== 'number' || !Number.isFinite(factor) || factor < 0.25 || factor > 5) throw new Error('Invalid site zoom');
    }
  }
}

// Upgrade the former defaults once; subsequent explicit choices remain unchanged.
export function migrateBrowserPermissionDefaults(data) {
  if ((data.permissionDefaultsVersion || 0) >= 2) return false;
  if (data.settings.agentEnabled === false || data.settings.agentEnabled === undefined) data.settings.agentEnabled = true;
  if (data.settings.historyAccess === 'ask' || data.settings.historyAccess === undefined) data.settings.historyAccess = 'allow';
  data.permissionDefaultsVersion = 2;
  return true;
}

/** Local, account/environment isolated browser metadata. encrypt(string) returns bytes;
 * decrypt(Buffer) returns a string. Supply Electron safeStorage callbacks in main. */
export class BrowserLibrary {
  constructor({ directory, encrypt, decrypt }) { this.directory = path.resolve(text(directory, 'directory')); this.encrypt = encrypt; this.decrypt = decrypt; }
  file(scope) {
    const owner = text(scope?.owner, 'owner');
    const environmentId = scope?.environmentId === null ? null : text(scope?.environmentId, 'environmentId');
    return path.join(this.directory, `${createHash('sha256').update(JSON.stringify([owner, environmentId])).digest('hex')}.json`);
  }
  async read(file) {
    let raw;
    try { raw = await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return blank(); throw error; }
    try {
      const data = JSON.parse(raw);
      if (data.version !== 1 || !data.settings || collections.some(k => !Array.isArray(data[k])) || (data.vault !== null && typeof data.vault !== 'string')) throw new Error('Invalid schema');
      validateSettings(data.settings);
      data.settings = { ...clone(DEFAULT_BROWSER_SETTINGS), ...data.settings };
      migrateBrowserPermissionDefaults(data);
      return data;
    } catch (cause) { throw new Error('Browser library is damaged; original data was preserved', { cause }); }
  }
  async vault(data) {
    if (!data.vault) return { passwords: [], contacts: [] };
    if (typeof this.decrypt !== 'function') throw new Error('Secure storage is unavailable');
    try { const v = JSON.parse(await this.decrypt(Buffer.from(data.vault, 'base64'))); if (!Array.isArray(v.passwords) || !Array.isArray(v.contacts)) throw new Error('Invalid vault'); return v; }
    catch (cause) { throw new Error('Cannot decrypt browser vault; original data was preserved', { cause }); }
  }
  async write(file, data) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await open(tmp, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); } finally { await handle.close(); }
      await rename(tmp, file);
    } finally { await unlink(tmp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async public(data) {
    const v = await this.vault(data);
    const { vault, tabs, ...publicData } = data;
    return clone({ ...publicData, passwords: v.passwords.map(({ id, origin, username, updatedAt }) => ({ id, origin, username, updatedAt })), contacts: v.contacts.map(({ id, label, updatedAt }) => ({ id, label, updatedAt })) });
  }
  async mutate(scope, fn) {
    const file = this.file(scope);
    const task = (queues.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
      const data = await this.read(file);
      // Validate the encrypted payload before any write, including metadata updates.
      await this.vault(data);
      await fn(data);
      const result = await this.public(data);
      await this.write(file, data);
      return result;
    });
    queues.set(file, task);
    try { return await task; } finally { if (queues.get(file) === task) queues.delete(file); }
  }
  async get(scope) { const file = this.file(scope); await (queues.get(file) || Promise.resolve()).catch(() => {}); return this.public(await this.read(file)); }
  settings(scope, patch) { validateSettings(patch); const next = clone(patch); return this.mutate(scope, d => Object.assign(d.settings, next)); }
  history(scope, record) { const href = url(record.url); return this.mutate(scope, d => { d.history.unshift({ id: randomUUID(), url: href, title: String(record.title || href).slice(0, 2048), visitedAt: Date.now() }); d.history.length = Math.min(d.history.length, 2000); }); }
  bookmark(scope, record) {
    if (record.remove) return this.remove(scope, 'bookmarks', record.id);
    const href = url(record.url); return this.mutate(scope, d => {
      const old = record.id ? d.bookmarks.find(x => x.id === record.id) : d.bookmarks.find(x => x.url === href);
      const next = { id: old?.id || randomUUID(), url: href, title: String(record.title || href).slice(0, 2048), updatedAt: Date.now() };
      if (old) Object.assign(old, next); else d.bookmarks.push(next);
    });
  }
  download(scope, record) {
    const id = text(record.id, 'download id', 256);
    return this.mutate(scope, d => { const old = d.downloads.find(x => x.id === id); const next = { ...old, ...clone(record), id }; if (next.url) next.url = url(next.url); if (old) Object.assign(old, next); else d.downloads.unshift(next); d.downloads.length = Math.min(d.downloads.length, 2000); });
  }
  remove(scope, collection, id) {
    if (!['history', 'bookmarks', 'downloads', 'permissions', 'agentRules', 'extensions', 'passwords', 'contacts'].includes(collection)) throw new Error('Invalid collection');
    text(id, 'id', 256);
    return this.mutate(scope, async d => { if (['passwords', 'contacts'].includes(collection)) { const v = await this.vault(d); v[collection] = v[collection].filter(x => x.id !== id); await this.seal(d, v); } else d[collection] = d[collection].filter(x => x.id !== id); });
  }
  clear(scope, names) { if (!Array.isArray(names) || names.some(n => !['history', 'downloads'].includes(n))) throw new Error('Invalid clear collections'); return this.mutate(scope, d => { for (const name of names) d[name] = []; }); }
  async seal(data, vault) { if (typeof this.encrypt !== 'function' || typeof this.decrypt !== 'function') throw new Error('Secure storage is unavailable'); const encrypted = await this.encrypt(JSON.stringify(vault)); if (!Buffer.isBuffer(encrypted) && !(encrypted instanceof Uint8Array)) throw new Error('Encryption must return bytes'); data.vault = Buffer.from(encrypted).toString('base64'); }
  password(scope, record) {
    const site = origin(record.origin || record.url); const username = text(record.username, 'username', 2048);
    return this.mutate(scope, async d => {
      const v = await this.vault(d); const old = record.id ? v.passwords.find(x => x.id === record.id) : v.passwords.find(x => x.origin === site && x.username === username);
      if (record.id && !old) throw new Error('Password not found');
      const password = record.password === undefined && old ? old.password : record.password;
      if (typeof password !== 'string' || !password || password.length > 65536) throw new Error('Invalid password');
      const next = { id: old?.id || randomUUID(), origin: site, username, password, updatedAt: Date.now() };
      if (old) Object.assign(old, next); else v.passwords.push(next); await this.seal(d, v);
    });
  }
  async revealPassword(scope, id) { const file = this.file(scope); await (queues.get(file) || Promise.resolve()).catch(() => {}); const v = await this.vault(await this.read(file)); const record = v.passwords.find(x => x.id === id); if (!record) throw new Error('Password not found'); return clone(record); }
  contact(scope, record) {
    const label = text(record.label || record.name, 'contact label', 256);
    return this.mutate(scope, async d => { const v = await this.vault(d); const old = record.id ? v.contacts.find(x => x.id === record.id) : null; if (record.id && !old) throw new Error('Contact not found'); const next = { id: old?.id || randomUUID(), label, updatedAt: Date.now() }; for (const key of ['name', 'email', 'phone', 'address']) { if (record[key] !== undefined && (typeof record[key] !== 'string' || record[key].length > 4096)) throw new Error(`Invalid contact ${key}`); next[key] = record[key] ?? old?.[key] ?? ''; } if (old) Object.assign(old, next); else v.contacts.push(next); await this.seal(d, v); });
  }
  async revealContact(scope, id) { const file = this.file(scope); await (queues.get(file) || Promise.resolve()).catch(() => {}); const v = await this.vault(await this.read(file)); const record = v.contacts.find(x => x.id === id); if (!record) throw new Error('Contact not found'); return clone(record); }
  permission(scope, record) { const site = origin(record.origin); const permission = text(record.permission, 'permission', 128); if (!values.includes(record.value)) throw new Error('Invalid permission value'); return this.mutate(scope, d => { const id = `${site}|${permission}`; const next = { id, origin: site, permission, value: record.value }; const old = d.permissions.find(x => x.id === id); if (old) Object.assign(old, next); else d.permissions.push(next); }); }
  agentRule(scope, record) { const pattern = text(record.pattern || record.origin, 'site pattern', 1024); if (pattern !== '*' && !/^https?:\/\/(?:\*\.)?[^/\s]+\/?$/.test(pattern)) throw new Error('Invalid site pattern'); const next = { id: record.id || randomUUID(), pattern }; for (const key of ['browse', 'download']) { const value = record[key] || 'ask'; if (!values.includes(value)) throw new Error('Invalid agent permission'); next[key] = value; } return this.mutate(scope, d => { const old = d.agentRules.find(x => x.id === next.id || x.pattern === pattern); if (old) Object.assign(old, { ...next, id: old.id }); else d.agentRules.push(next); }); }
  extension(scope, record) { const id = text(record.id, 'extension id', 256); const directory = text(record.path, 'extension path'); if (!path.isAbsolute(directory)) throw new Error('Invalid extension path'); return this.mutate(scope, d => { const next = { id, path: directory, name: String(record.name || id).slice(0, 256), enabled: record.enabled !== false }; const old = d.extensions.find(x => x.id === id); if (old) Object.assign(old, next); else d.extensions.push(next); }); }
  saveSession(scope, tabs) { if (!Array.isArray(tabs) || tabs.length > 200) throw new Error('Invalid tabs'); const next = tabs.map(t => ({ url: url(t.url), title: String(t.title || '').slice(0, 2048) })); return this.mutate(scope, d => { d.tabs = next; }); }
  async session(scope) { const file = this.file(scope); await (queues.get(file) || Promise.resolve()).catch(() => {}); return clone((await this.read(file)).tabs); }
}
