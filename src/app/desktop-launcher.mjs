import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {access, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import {createPackage, extractAll, getRawHeader} from '@electron/asar';
import path from 'node:path';
import {promisify} from 'node:util';
import {appIdentity} from '../shared/app-identity.mjs';

const exec = promisify(execFile);
async function setBundleValue(info, key, value) {
  // Some upstream helper plists omit CFBundleExecutable/CFBundleDisplayName.
  try { await exec('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, info]); }
  catch { await exec('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, info]); }
}

// Mirror the default loader's argument categories without replacing its behavior.
export function defaultApplicationArgs(args, root) {
  let requireArgument = false, diagnostic = false;
  for (const arg of args) {
    if (requireArgument) { requireArgument = false; continue; }
    if (arg === '--require' || arg === '-r') { requireArgument = true; continue; }
    if (arg.startsWith('--app=') || !arg.startsWith('-')) return args;
    if (['--version', '-v', '--abi', '-a', '--interactive', '-i', '-repl', '--test-type=webdriver'].includes(arg)) diagnostic = true;
  }
  if (requireArgument || diagnostic) return args;
  // Append after switches so --require is still processed by the upstream loader.
  return [...args, root];
}

async function prepareDefaultApplication(staged, temporary, root) {
  const archive = path.join(staged, 'Contents/Resources/default_app.asar');
  const directory = path.join(temporary, 'default-application');
  extractAll(archive, directory);
  const manifestPath = path.join(directory, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const originalMain = manifest.main;
  manifest.main = 'kuneco-bootstrap.js';
  manifest.name = appIdentity.name;
  manifest.productName = appIdentity.title;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2)+'\n');
  await writeFile(path.join(directory, manifest.main), `// Kuneco default entry; upstream loader and resources are retained.\nconst defaultApplicationArgs = ${defaultApplicationArgs.toString()};\nprocess.argv.splice(1, process.argv.length - 1, ...defaultApplicationArgs(process.argv.slice(1), ${JSON.stringify(path.resolve(root))}));\nawait import(${JSON.stringify('./'+originalMain)});\n`);
  await createPackage(directory, archive);
  const integrity = createHash('sha256').update(getRawHeader(archive).headerString).digest('hex');
  await setBundleValue(path.join(staged, 'Contents/Info.plist'), 'ElectronAsarIntegrity:Resources/default_app.asar:hash', integrity);
}

// macOS reads its menu-bar name from the native bundle, even in development.
// Keep the installed Electron bundle untouched. main.mjs retains the legacy
// userData path and migrates its Keychain key before opening the workspace.
export async function desktopExecutable({root, electron, platform = process.platform}) {
  if (platform !== 'darwin') return electron;
  const source = path.resolve(path.dirname(electron), '../..');
  const plist = await readFile(path.join(source, 'Contents/Info.plist'));
  const binary = await stat(electron);
  const icon = path.join(root, 'src/assets/brand/kuneco.icns');
  const revision = createHash('sha256').update(plist).update(await readFile(icon)).update(getRawHeader(path.join(source,'Contents/Resources/default_app.asar')).headerString).update(`${binary.size}:${binary.mtimeMs}:Kuneco-v7:${path.resolve(root)}:${JSON.stringify(appIdentity)}`).digest('hex').slice(0, 16);
  const cache = path.join(root, 'node_modules/.cache/kuneco-desktop', revision);
  const bundle = path.join(cache, 'Kuneco.app');
  const executable = path.join(bundle, 'Contents/MacOS', appIdentity.title);
  try { await access(executable); return executable; } catch {}
  await mkdir(cache, {recursive: true});
  const temporary = await mkdtemp(path.join(cache, '.prepare-'));
  try {
    const staged = path.join(temporary, 'Kuneco.app');
    await exec('/usr/bin/ditto', ['--clone', source, staged]);
    await prepareDefaultApplication(staged, temporary, root);
    const info = path.join(staged, 'Contents/Info.plist');
    const values = {
      CFBundleName: appIdentity.title,
      CFBundleDisplayName: appIdentity.title,
      CFBundleIdentifier: appIdentity.bundleId,
      CFBundleExecutable: appIdentity.title,
      CFBundleShortVersionString: appIdentity.version,
      CFBundleVersion: appIdentity.version,
      CFBundleIconFile: 'kuneco.icns',
    };
    for (const [key, value] of Object.entries(values)) {
      await setBundleValue(info, key, value);
    }
    await copyFile(icon, path.join(staged, 'Contents/Resources/kuneco.icns'));
    await rename(path.join(staged, 'Contents/MacOS', path.basename(electron)), path.join(staged, 'Contents/MacOS', appIdentity.title));
    // Local development signature; this is not a signed/notarized release build.
    // The development runtime includes linker-signed frameworks without resource
    // envelopes. Deep signing also seals those unchanged framework resources.
    await exec('/usr/bin/codesign', ['--force', '--deep', '--preserve-metadata=entitlements', '--sign', '-', staged]);
    await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]);
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
