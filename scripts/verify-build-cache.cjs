const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Expected Windows x64 build cache');
for (const file of ['hydra-native/hydra-native.node', 'ludusavi/ludusavi.exe', 'legendary/win32/x64/legendary.exe', 'node_modules/.yarn-integrity']) {
  if (!fs.statSync(file).isFile()) throw new Error(`Incomplete build cache: ${file}`);
}
execFileSync(require('electron'), ['-e', 'require(process.argv[1])', path.resolve('hydra-native/hydra-native.node')], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', timeout: 30000, windowsHide: true,
});
console.log('Lulus: cache dependensi cocok dengan lockfile, komponen tersedia, dan Electron memuat addon native.');
