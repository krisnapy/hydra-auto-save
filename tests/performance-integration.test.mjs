import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
import { integrate } from '../scripts/apply-hydra.mjs';

const metadata = JSON.parse(await fs.readFile(new URL('../integration/upstream.json', import.meta.url), 'utf8'));
const files = Object.fromEntries(await Promise.all(Object.keys(metadata.files).map(async file => [file, await fs.readFile(new URL(`./fixtures/hydra-4.3.0/${file}`, import.meta.url), 'utf8')])));
const patched = integrate(files);

test('tray opens cached menu immediately, coalesces slow library reads, and restores minimized window', async () => {
  let release, reads = 0, created = 0, launches = 0, launchError;
  const library = new Promise(resolve => { release = resolve; });
  let tray;
  class Tray extends EventEmitter {
    constructor() { super(); created++; tray = this; }
    setImage() {}
    setToolTip(value) { this.tooltip = value; }
    isDestroyed() { return false; }
    popUpContextMenu(menu) { this.menu = menu; }
  }
  const nativeTheme = new EventEmitter();
  const module = { exports: {} };
  const dependencies = {
    electron: { Tray, Menu: { buildFromTemplate: items => ({ items }) }, nativeTheme, app: { quit() {} }, dialog: { showErrorBox: (title, message) => { launchError = message; } } },
    '../helpers/launch-game': { launchGame: async () => { launches++; throw new Error('Pemulihan sedang berjalan'); } },
    '@main/level': { gamesSublevel: { values: () => ({ all: () => { reads++; return library; } }) } },
    './personal-cloud-backup': { getPersonalBackup: async () => ({ snapshot: async () => ({ enabled: true, operations: [] }) }) },
    'node:path': path,
    'lodash-es': { orderBy: list => list },
    i18next: { t: key => key },
    './logger': { logger: { warn() {} } },
  };
  const output = ts.transpileModule(patched['src/main/services/window-manager.ts'].replaceAll('import.meta.env', '({})'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(output, { exports: module.exports, module, require: name => dependencies[name] ?? {}, process: { platform: 'win32', env: {} }, __dirname: '/test', console, setTimeout, clearTimeout });
  const Manager = module.exports.WindowManager;
  await Manager.createSystemTray('en');
  assert.equal(reads, 1);
  tray.emit('right-click');
  assert.ok(tray.menu.items.some(item => item.label === 'Buka Hydra Personal Backup'));
  tray.emit('right-click');
  assert.equal(reads, 1);
  await Manager.createSystemTray('en');
  assert.equal(created, 1);
  let shown = false, restored = false, focused = false;
  Manager.mainWindowInstance = { show: () => { shown = true; }, isMinimized: () => true, restore: () => { restored = true; }, focus: () => { focused = true; }, isDestroyed: () => false };
  tray.emit('double-click');
  assert.ok(shown && restored && focused);
  release([{ title: 'Game fixture', executablePath: 'C:\\fixture.exe', shop: 'steam', objectId: '1', lastTimePlayed: 1 }]);
  await new Promise(resolve => setImmediate(resolve));
  tray.emit('right-click');
  assert.ok(tray.menu.items.some(item => item.label === 'Auto Backup aktif'));
  await tray.menu.items.find(item => item.label === 'Game fixture').click();
  assert.equal(launches, 1);
  assert.match(launchError, /Pemulihan/);
});

test('startup loads local auth without waiting for the remote profile, and stale refresh cannot replace current auth', async () => {
  const source = ts.createSourceFile('hydra-api.ts', patched['src/main/services/hydra-api.ts'], ts.ScriptTarget.Latest, true);
  const api = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'HydraApi');
  const setup = api.members.find(node => node.name?.getText(source) === 'setupApi');
  let release;
  const remote = new Promise(resolve => { release = resolve; });
  let updated = false;
  const module = { exports: {} };
  const compiled = ts.transpileModule(`class Probe { ${setup.getText(source)} } exports.Probe = Probe;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.replaceAll('import.meta.env', '({})');
  vm.runInNewContext(compiled, {
    exports: module.exports, axios: { create: () => ({}) }, appVersion: '4.3.0',
    db: { getMany: async () => [{ accessToken: 'fixture', refreshToken: '', tokenExpirationTimestamp: 1 }, {}] },
    levelKeys: {}, clearGamesPlaytimeState() {}, clearStaleEpicImports: async () => {}, getUserData: () => remote,
    logger: { warn() {} },
  });
  const { Probe } = module.exports;
  Probe.authContexts = { generation: 1, invalidate() { return this.generation; } };
  Probe.activateAuthContext = () => {};
  Probe.getAuthContext = () => ({});
  Probe.updateUserSubscription = () => { updated = true; };
  let timer;
  try {
    await Promise.race([Probe.setupApi(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Startup waited for remote profile')), 500); })]);
    assert.equal(Probe.userAuth.authToken, 'fixture');
    assert.equal(updated, false);
    Probe.authContexts.generation++;
    release({ subscription: {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(updated, false);
  } finally { clearTimeout(timer); }
});

test('optional startup paths share initialization so credential cleanup cannot overlap', async () => {
  const source = await fs.readFile(new URL('../integration/overlay/src/main/services/personal-cloud-backup/optional-startup.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let calls = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require: () => ({ initializeEpicIntegration: () => { calls++; return pending; } }) });
  const first = module.exports.initializeOptionalEpic();
  const second = module.exports.initializeOptionalEpic();
  assert.equal(first, second);
  assert.equal(calls, 1);
  release();
  await first;
  await module.exports.initializeOptionalEpic();
  assert.equal(calls, 1);
});
