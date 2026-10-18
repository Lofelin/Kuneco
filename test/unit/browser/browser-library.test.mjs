import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { BrowserLibrary } from '../../../src/features/browser/browser-library.mjs';

const scope = { owner: 'account-a', environmentId: 'environment-a' };
async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'browser-library-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const key = randomBytes(32);
  const encrypt = text => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); };
  const decrypt = bytes => { const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'); };
  return { directory, encrypt, decrypt, lib: new BrowserLibrary({ directory, encrypt, decrypt }) };
}
test('isolates account/environment and validates scope and settings', async t => {
  const { lib, directory } = await setup(t);
  await lib.settings(scope, { showFullUrl: false, webLinks: 'external' });
  assert.equal((await lib.get(scope)).settings.showFullUrl, false);
  assert.equal((await lib.get({ ...scope, owner: 'account-b' })).settings.showFullUrl, true);
  assert.equal((await lib.get({ ...scope, environmentId: 'environment-b' })).settings.showFullUrl, true);
  await assert.rejects(lib.get({ owner: '', environmentId: 'x' }), /owner/);
  assert.throws(() => lib.settings(scope, { unknown: true }), /Unknown/);
  assert.throws(() => lib.settings(scope, { restoreTabs: 'true' }), /Invalid/);
  assert.match((await readdir(directory))[0], /^[a-f0-9]{64}\.json$/);
});
test('password and contact vault encrypted at rest, metadata only by default, restart readable', async t => {
  const options = await setup(t); const { lib, directory } = options;
  await lib.password(scope, { origin: 'https://example.com/login', username: 'alice', password: 'secret-never-write-plaintext' });
  await lib.contact(scope, { label: 'Personal', name: 'Private Name', email: 'private@example.com', phone: '15550001111', address: 'Private Address' });
  const state = await lib.get(scope);
  assert.equal(state.passwords[0].password, undefined);
  assert.equal(state.contacts[0].email, undefined);
  assert.equal(state.passwords[0].origin, 'https://example.com');
  const raw = await readFile(path.join(directory, (await readdir(directory))[0]), 'utf8');
  for (const secret of ['secret-never-write-plaintext', 'private@example.com', 'Private Address', 'alice']) assert.equal(raw.includes(secret), false);
  const reopened = new BrowserLibrary(options);
  assert.equal((await reopened.revealPassword(scope, state.passwords[0].id)).password, 'secret-never-write-plaintext');
  assert.equal((await reopened.revealContact(scope, state.contacts[0].id)).email, 'private@example.com');
  await lib.password(scope, { id: state.passwords[0].id, origin: 'https://example.com', username: 'updated' });
  assert.equal((await lib.revealPassword(scope, state.passwords[0].id)).password, 'secret-never-write-plaintext');
  await lib.remove(scope, 'passwords', state.passwords[0].id);
  assert.deepEqual((await lib.get(scope)).passwords, []);
  assert.equal((await stat(path.join(directory, (await readdir(directory))[0]))).mode & 0o777, 0o600);
});
test('serializes concurrent instances without losing writes and persists an atomic JSON file', async t => {
  const options = await setup(t); const second = new BrowserLibrary(options);
  await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? second : options.lib).history(scope, { url: `https://example.com/${i}`, title: `Page ${i}` })));
  assert.equal((await second.get(scope)).history.length, 40);
  const files = await readdir(options.directory); assert.equal(files.length, 1);
  assert.equal(JSON.parse(await readFile(path.join(options.directory, files[0]), 'utf8')).history.length, 40);
  assert.throws(() => options.lib.history(scope, { url: 'javascript:alert(1)' }), /HTTP/);
  assert.throws(() => options.lib.history(scope, { url: 'https://username:password@example.com/' }), /credentials/);
});
test('damaged JSON and encrypted vault are never overwritten', async t => {
  const { lib, directory } = await setup(t);
  await lib.settings(scope, { restoreTabs: true });
  const file = path.join(directory, (await readdir(directory))[0]);
  await writeFile(file, '{broken');
  await assert.rejects(lib.history(scope, { url: 'https://example.com' }), /damaged/);
  assert.equal(await readFile(file, 'utf8'), '{broken');
  await rm(file);
  await lib.password(scope, { origin: 'https://example.com', username: 'alice', password: 'secret' });
  const document = JSON.parse(await readFile(file, 'utf8')); document.vault = Buffer.from('broken encryption').toString('base64');
  const broken = JSON.stringify(document); await writeFile(file, broken);
  await assert.rejects(lib.settings(scope, { restoreTabs: false }), /decrypt/);
  assert.equal(await readFile(file, 'utf8'), broken);
});
test('secure storage failure prevents credential write and metadata clear never deletes files or vault', async t => {
  const options = await setup(t); const { lib, directory } = options;
  const unavailable = new BrowserLibrary({ directory });
  await assert.rejects(unavailable.password(scope, { origin: 'https://example.com', username: 'a', password: 'secret' }), /Secure storage/);
  assert.deepEqual(await readdir(directory), []);
  await lib.bookmark(scope, { url: 'https://example.com', title: 'Example' });
  await lib.download(scope, { id: 'd1', url: 'https://example.com/a', state: 'progressing', receivedBytes: 1 });
  await lib.download(scope, { id: 'd1', state: 'completed', receivedBytes: 10 });
  await lib.history(scope, { url: 'https://example.com' });
  await lib.password(scope, { origin: 'https://example.com', username: 'a', password: 'secret' });
  const before = await lib.get(scope); assert.equal(before.downloads.length, 1); assert.equal(before.downloads[0].receivedBytes, 10);
  const after = await lib.clear(scope, ['history', 'downloads']);
  assert.equal(after.history.length, 0); assert.equal(after.downloads.length, 0); assert.equal(after.bookmarks.length, 1); assert.equal(after.passwords.length, 1);
  assert.throws(() => lib.clear(scope, ['passwords']), /Invalid/);
});
test('persists permissions, agent rules, extensions and tab sessions', async t => {
  const { lib } = await setup(t);
  await lib.permission(scope, { origin: 'https://example.com/path', permission: 'media', value: 'allow' });
  await lib.permission(scope, { origin: 'https://example.com', permission: 'media', value: 'block' });
  await lib.agentRule(scope, { pattern: 'https://*.example.com', browse: 'allow', download: 'ask' });
  await lib.extension(scope, { id: 'extension', name: 'Example', path: '/tmp/example', enabled: false });
  await lib.saveSession(scope, [{ url: 'https://example.com', title: 'Example' }]);
  const state = await lib.get(scope);
  assert.equal(state.permissions.length, 1); assert.equal(state.permissions[0].value, 'block');
  assert.equal(state.agentRules[0].browse, 'allow'); assert.equal(state.extensions[0].enabled, false);
  assert.equal((await lib.session(scope))[0].url, 'https://example.com/');
  assert.equal(state.tabs, undefined);
});
test('local null environment, screenshot preference and per-origin zoom persist independently', async t => {
  const { lib } = await setup(t); const local = { ...scope, environmentId: null };
  await lib.settings(local, { annotationScreenshots: 'never', zoomByOrigin: { 'https://example.com': 1.25 } });
  assert.equal((await lib.get(local)).settings.zoomByOrigin['https://example.com'], 1.25);
  assert.deepEqual((await lib.get(scope)).settings.zoomByOrigin, {});
  assert.throws(() => lib.settings(local, { zoomByOrigin: { 'https://example.com/path': 1 } }), /zoom/);
  assert.throws(() => lib.settings(local, { zoomByOrigin: { 'https://example.com': 0 } }), /zoom/);
  assert.throws(() => lib.settings(local, { annotationScreenshots: 'allow' }), /screenshot/);
});
