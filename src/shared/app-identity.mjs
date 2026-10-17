import {readFileSync} from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
export const appIdentity = Object.freeze({
  name: manifest.name,
  title: manifest.productName,
  version: manifest.version,
  bundleId: 'io.github.lofelin.kuneco',
});
export const codexClientInfo = Object.freeze({
  name: appIdentity.name,
  title: appIdentity.title,
  version: appIdentity.version,
});
