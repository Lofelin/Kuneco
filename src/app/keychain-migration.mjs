import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const markerName = 'kuneco-keychain-migration-v1.json';
const options = {encoding: 'utf8', maxBuffer: 1024 * 1024};

export function migrationHelper() {
  const source = path.join(root, 'native/macos/keychain-migrate.m');
  const revision = createHash('sha256').update(readFileSync(source)).digest('hex').slice(0, 16);
  const directory = path.join(root, 'node_modules/.cache/kuneco-keychain', revision);
  const binary = path.join(directory, 'kuneco-keychain-migrate');
  if (!existsSync(binary)) {
    mkdirSync(directory, {recursive: true, mode: 0o700});
    const staged = binary + '.' + process.pid;
    execFileSync('/usr/bin/clang', ['-fobjc-arc', '-Wno-deprecated-declarations', '-framework', 'Foundation', '-framework', 'Security', source, '-o', staged], options);
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', staged], options);
    renameSync(staged, binary);
  }
  return binary;
}

function readMarker(directory) {
  try {
    const value = JSON.parse(readFileSync(path.join(directory, markerName), 'utf8'));
    if (value.version !== 1 || value.service !== 'Kuneco Safe Storage' || !['prepared','verified'].includes(value.phase)) throw new Error('invalid marker');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('钥匙串迁移记录损坏；已停止启动，原数据未被覆盖');
  }
}

function saveMarker(directory, value) {
  const file = path.join(directory, markerName);
  writeFileSync(file + '.tmp', JSON.stringify(value), {mode: 0o600});
  renameSync(file + '.tmp', file);
}

// Must run with the profile's single-instance lock, before Electron initializes
// OSCrypt. Neither the helper nor this module outputs key material.
export function prepareKeychainMigration({directory, executable, platform = process.platform,
  helper = migrationHelper, run = execFileSync} = {}) {
  if (platform !== 'darwin') return null;
  const marker = readMarker(directory);
  if (marker?.phase === 'verified') return marker;
  mkdirSync(directory, {recursive: true, mode: 0o700});
  const meaningful = readdirSync(directory).filter(name => !name.startsWith('Singleton') && name !== '.DS_Store' && name !== markerName);
  let backup = marker?.backup;
  if (!backup && meaningful.length) {
    const parent = path.join(path.dirname(directory), 'Kuneco-keychain-backups');
    mkdirSync(parent, {recursive: true, mode: 0o700});
    backup = mkdtempSync(path.join(parent, 'before-migration-'));
    run('/usr/bin/ditto', [directory, path.join(backup, 'profile')], options);
  }
  const binary = helper();
  console.log('正在迁移 Kuneco 钥匙串；如出现系统提示，请在系统窗口授权。');
  let result;
  try { result = JSON.parse(run(binary, ['--migrate', executable], {...options, timeout: 300000})); }
  catch { throw new Error('钥匙串迁移未完成（授权取消、超时或密钥冲突）；旧密钥和备份已保留，未启动工作空间'); }
  if (!['copied', 'already-migrated', 'source-missing'].includes(result.status)) throw new Error('钥匙串迁移结果无效');
  if (result.status === 'source-missing' && meaningful.length) throw new Error('旧钥匙串密钥缺失；为保护已有数据已停止启动');
  const prepared = {version: 1, service: 'Kuneco Safe Storage', phase: 'prepared', backup: backup || null, result: result.status};
  saveMarker(directory, prepared);
  return prepared;
}

// Verify every application safeStorage record before AccountClient or any
// background writer can replace an unreadable cache with an empty state.
export function verifyKeychainMigration({directory, storage, migration}) {
  if (!migration || migration.phase === 'verified') return;
  if (!storage.isEncryptionAvailable()) throw new Error('Kuneco 钥匙串不可用；旧数据已保留');
  let verified = 0;
  const decrypt = bytes => { storage.decryptString(bytes); verified++; };
  const walk = current => {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, {withFileTypes: true})) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith('.bin')) decrypt(readFileSync(file));
    }
  };
  try {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      if (entry.isFile() && (entry.name === 'account-session.bin' || /^chat-cache-.*\.bin$/.test(entry.name))) decrypt(readFileSync(path.join(directory, entry.name)));
    }
    for (const subdir of ['connection-records', 'docker-environments']) walk(path.join(directory, subdir));
    const proxy = path.join(directory, 'proxy.json');
    if (existsSync(proxy)) {
      const value = JSON.parse(readFileSync(proxy, 'utf8'));
      if (value.secret) decrypt(Buffer.from(value.secret, 'base64'));
    }
    const probe = 'Kuneco keychain migration verification';
    if (storage.decryptString(storage.encryptString(probe)) !== probe) throw new Error('roundtrip failed');
  } catch { throw new Error('Kuneco 密钥无法验证原有加密数据；已停止启动并保留旧密钥和备份'); }
  saveMarker(directory, {...migration, phase: 'verified', verifiedRecords: verified, verifiedAt: new Date().toISOString()});
  console.log(`Kuneco 钥匙串迁移完成：已验证 ${verified} 项加密记录。`);
}
