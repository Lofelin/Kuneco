import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {access, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {extractFile, getRawHeader} from '@electron/asar';
import {tmpdir} from 'node:os';
import path from 'node:path';
import electron from 'electron';
import {defaultApplicationArgs, desktopExecutable} from '../../../src/app/desktop-launcher.mjs';

test('default app routing preserves explicit apps, preloads, runtime diagnostics and test switches', () => {
  const root = '/workspace/Kuneco';
  for (const args of [[], ['--test-fixture'], ['--remote-debugging-port=1234', '--test-fixture'], ['--require','preload.cjs']]) assert.deepEqual(defaultApplicationArgs(args, root), [...args, root]);
  for (const args of [['.'], ['app.cjs','--test-fixture'], ['/another/project'], ['--app=/another/project'], ['--require','preload.cjs','app.cjs'], ['--require'], ['--version'], ['-v'], ['--abi'], ['--interactive'], ['--test-type=webdriver']]) assert.deepEqual(defaultApplicationArgs(args, root), args);
});

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
    const archive = path.join(bundle, 'Contents/Resources/default_app.asar');
    const originalArchive = await readFile(path.join(source, 'Contents/Resources/default_app.asar'));
    const bundledApp = JSON.parse(extractFile(archive, 'package.json').toString());
    assert.equal(bundledApp.main, 'kuneco-bootstrap.js');
    assert.match(extractFile(archive, bundledApp.main).toString(), /await import\("\.\/main\.js"\)/);
    assert.ok(extractFile(archive, bundledApp.main).toString().includes(JSON.stringify(root)));
    assert.deepEqual(extractFile(archive, 'main.js'), extractFile(path.join(source, 'Contents/Resources/default_app.asar'), 'main.js'));
    assert.equal(value('ElectronAsarIntegrity:Resources/default_app.asar:hash'), createHash('sha256').update(getRawHeader(archive).headerString).digest('hex'));
    await assert.rejects(access(path.join(bundle, 'Contents/Resources/app')));
    assert.equal(bundledApp.type, 'module');
    assert.equal(bundledApp.productName, 'Kuneco');
    assert.ok((await stat(executable)).mode & 0o111);
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
    assert.equal(value('CFBundleIconFile'), 'kuneco.icns');
    assert.deepEqual(await readFile(path.join(bundle, 'Contents/Resources/kuneco.icns')), await readFile(path.join(root, 'src/assets/brand/kuneco.icns')));
    const before = (await stat(executable)).mtimeMs;
    assert.equal(await desktopExecutable({root, electron}), executable);
    assert.equal((await stat(executable)).mtimeMs, before);
    assert.deepEqual(await readFile(path.join(source, 'Contents/Info.plist')), original);
    assert.deepEqual(await readFile(path.join(source, 'Contents/Resources/default_app.asar')), originalArchive);
    // Exercise the actual default loader, not just the generated bootstrap text.
    await writeFile(path.join(root, 'package.json'), JSON.stringify({name:'kuneco-branding-fixture', main:'default.cjs'}));
    await writeFile(path.join(root, 'default.cjs'), `const {app}=require('electron'); console.log('KUNECO_DEFAULT '+JSON.stringify(process.argv));app.whenReady().then(()=>app.quit());`);
    const explicit = path.join(root, 'explicit.cjs');
    await writeFile(explicit, `const {app}=require('electron');console.log('KUNECO_EXPLICIT');app.whenReady().then(()=>app.quit());`);
    const launch = args => execFileSync(executable, args, {cwd:root, encoding:'utf8', timeout:15000});
    assert.match(launch([]), /KUNECO_DEFAULT/);
    assert.match(launch(['--test-fixture']), /KUNECO_DEFAULT.*--test-fixture/);
    const selected = launch([explicit, '--test-fixture']);
    assert.match(selected, /KUNECO_EXPLICIT/);
    assert.doesNotMatch(selected, /KUNECO_DEFAULT/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
