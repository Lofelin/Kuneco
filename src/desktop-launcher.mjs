import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {access, mkdir, mkdtemp, readFile, rename, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

const exec = promisify(execFile);

// macOS reads its menu-bar name from the native bundle, even in development.
// Keep the installed Electron bundle untouched and retain its credential identity.
export async function desktopExecutable({root, electron, platform = process.platform}) {
  if (platform !== 'darwin') return electron;
  const source = path.resolve(path.dirname(electron), '../..');
  const plist = await readFile(path.join(source, 'Contents/Info.plist'));
  const binary = await stat(electron);
  const revision = createHash('sha256').update(plist).update(`${binary.size}:${binary.mtimeMs}:Kuneco-v1`).digest('hex').slice(0, 16);
  const cache = path.join(root, 'node_modules/.cache/kuneco-desktop', revision);
  const bundle = path.join(cache, 'Kuneco.app');
  const executable = path.join(bundle, 'Contents/MacOS', path.basename(electron));
  try { await access(executable); return executable; } catch {}
  await mkdir(cache, {recursive: true});
  const temporary = await mkdtemp(path.join(cache, '.prepare-'));
  try {
    const staged = path.join(temporary, 'Kuneco.app');
    await exec('/usr/bin/ditto', [source, staged]);
    const info = path.join(staged, 'Contents/Info.plist');
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      await exec('/usr/libexec/PlistBuddy', ['-c', `Set :${key} Kuneco`, info]);
    }
    // Local development signature; this is not a signed/notarized release build.
    await exec('/usr/bin/codesign', ['--force', '--sign', '-', staged]);
    try { await rename(staged, bundle); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      await access(executable); // Another launcher finished the same cache entry.
    }
    return executable;
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
}
