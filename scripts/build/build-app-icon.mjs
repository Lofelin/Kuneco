import {execFileSync} from 'node:child_process';
import {copyFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

if (process.platform !== 'darwin') throw new Error('App icon generation requires macOS');
const root = fileURLToPath(new URL('../..', import.meta.url));
const brand = path.join(root, 'src/assets/brand');
const temporary = await mkdtemp(path.join(tmpdir(), 'kuneco-icon-'));
try {
  const iconset = path.join(temporary, 'kuneco.iconset');
  execFileSync('/usr/bin/swift', [path.join(root, 'native/macos/app-icon.swift'), path.join(brand, 'kuneco.png'), iconset], {stdio: 'inherit'});
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(brand, 'kuneco.icns')], {stdio: 'inherit'});
  await copyFile(path.join(iconset, 'icon_512x512@2x.png'), path.join(brand, 'kuneco-macos.png'));
} finally {
  await rm(temporary, {recursive: true, force: true});
}
