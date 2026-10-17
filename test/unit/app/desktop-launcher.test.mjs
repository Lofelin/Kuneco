import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import electron from 'electron';
import {desktopExecutable} from '../../../src/app/desktop-launcher.mjs';

test('non-macOS launches the original executable without preparing a bundle', async () => {
  assert.equal(await desktopExecutable({root: '/unused', electron: '/original/electron', platform: 'linux'}), '/original/electron');
});

test('macOS bundle has product identity, uses the Kuneco icon, and reuses its complete cache', {skip: process.platform !== 'darwin'}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kuneco-branding-'));
  const source = path.resolve(path.dirname(electron), '../..');
  const original = await readFile(path.join(source, 'Contents/Info.plist'));
  const manifest = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
  try {
    await mkdir(path.join(root, 'src/assets/brand'), {recursive: true});
    await copyFile(new URL('../../../src/assets/brand/kuneco.icns', import.meta.url), path.join(root, 'src/assets/brand/kuneco.icns'));
    const executable = await desktopExecutable({root, electron});
    const bundle = path.resolve(path.dirname(executable), '../..');
    const info = path.join(bundle, 'Contents/Info.plist');
    const value = key => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, info], {encoding: 'utf8'}).trim();
    assert.equal(value('CFBundleIdentifier'), 'io.github.lofelin.kuneco');
    for (const key of ['CFBundleName', 'CFBundleDisplayName', 'CFBundleExecutable']) assert.equal(value(key), 'Kuneco');
    for (const key of ['CFBundleVersion', 'CFBundleShortVersionString']) assert.equal(value(key), manifest.version);
    assert.equal(path.basename(executable), 'Kuneco');
    assert.ok((await stat(executable)).mode & 0o111);
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
    assert.equal(value('CFBundleIconFile'), 'kuneco.icns');
    assert.deepEqual(await readFile(path.join(bundle, 'Contents/Resources/kuneco.icns')), await readFile(path.join(root, 'src/assets/brand/kuneco.icns')));
    const before = (await stat(executable)).mtimeMs;
    assert.equal(await desktopExecutable({root, electron}), executable);
    assert.equal((await stat(executable)).mtimeMs, before);
    assert.deepEqual(await readFile(path.join(source, 'Contents/Info.plist')), original);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
