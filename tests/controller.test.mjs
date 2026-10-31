import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BackupController } from '../module/controller.mjs';
import { withLaunchGate, withRestoreGate } from '../module/launch-guard.mjs';

test('poll otomatis, manual, penyimpanan status dan restart perangkat', async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-controller-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'save.sav');
  await fs.writeFile(file, 'start');
  const options = { stateDirectory: path.join(root, 'state'), stableMs: 1, getGames: async () => [{ id: 'steam:1', title: 'Game', shop: 'steam', objectId: '1' }], assertStopped: async () => {} };
  const controller = await new BackupController(options).init();
  await controller.configure({ destination: path.join(root, 'offline-cloud'), enabled: true });
  await controller.manual('steam:1', [{ path: file }]);
  await controller.tick();
  let view = await controller.snapshot('steam:1');
  assert.equal(view.versions.length, 1);
  assert.equal(view.status.status, 'complete');
  await controller.tick();
  assert.equal((await controller.snapshot('steam:1')).versions.length, 1);
  await fs.writeFile(file, 'new-progress');
  await controller.tick();
  assert.equal((await controller.snapshot('steam:1')).versions.length, 2);
  const restart = await new BackupController(options).init();
  assert.equal((await restart.snapshot('steam:1')).deviceId, view.deviceId);
  assert.equal((await restart.snapshot('steam:1')).versions.length, 2);
  await controller.configure({ enabled: false });
  await fs.writeFile(file, 'while-disabled');
  await controller.tick();
  assert.equal((await controller.snapshot('steam:1')).versions.length, 2);
});

test('peluncuran dan pemulihan saling mengunci termasuk masa tunggu deteksi proses', async () => {
  let resolve;
  const pending = withRestoreGate('game-a', () => new Promise(done => { resolve = done; }));
  await assert.rejects(withLaunchGate('game-a', async () => {}), /Pemulihan/);
  resolve(); await pending;
  await withLaunchGate('game-a', async () => {});
  await assert.rejects(withRestoreGate('game-a', async () => {}), /sedang dibuka/);
});

test('deteksi gagal ditampilkan sebagai perlu pengaturan', async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-controller-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const controller = await new BackupController({ stateDirectory: path.join(root, 'state'), getGames: async () => [{ id: 'steam:unknown', title: 'Unknown' }] }).init();
  await controller.configure({ enabled: true, destination: path.join(root, 'cloud') });
  await controller.tick();
  assert.equal((await controller.snapshot('steam:unknown')).status.status, 'setup');
  assert.match((await controller.snapshot('steam:unknown')).status.detail, /ludusavi.exe/);
});

test('pengaturan menunggu satu operasi aktif lalu mendapat giliran sebelum game berikutnya', async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-queue-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const games = [1, 2].map(id => ({ id: `steam:${id}`, title: `Game ${id}`, shop: 'steam', objectId: String(id) }));
  const controller = await new BackupController({ stateDirectory: path.join(root, 'state'), stableMs: 1, getGames: async () => games }).init();
  await controller.configure({ destination: path.join(root, 'cloud'), enabled: true });
  for (const game of games) {
    const file = path.join(root, `${game.objectId}.sav`);
    await fs.writeFile(file, 'progress');
    await controller.manual(game.id, [{ path: file }]);
  }
  const scan = controller.engine.scan.bind(controller.engine);
  let release, entered;
  const hold = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let once = true;
  controller.engine.scan = async roots => {
    if (once) { once = false; entered(); await hold; }
    return scan(roots);
  };
  const automatic = controller.tick();
  await started;
  const configure = controller.configure({ retention: 20 });
  const queued = await controller.snapshot(undefined, true);
  assert.ok(queued.operations.some(operation => operation.kind === 'automatic' && operation.phase === 'scanning'));
  assert.ok(queued.operations.some(operation => operation.kind === 'settings' && operation.phase === 'queued'));
  release();
  await Promise.all([automatic, configure]);
  const view = await controller.snapshot('steam:1');
  assert.equal(view.retention, 20);
  assert.equal(view.operations.length, 0);
  assert.equal((await controller.snapshot()).lastOperation.kind, 'settings');
  assert.equal(view.lastOperation.kind, 'automatic');
  assert.equal(view.lastOperation.status, 'complete');
  assert.equal(view.versions.length, 1);
  assert.equal((await controller.snapshot('steam:2')).versions.length, 0);
});

test('antrean tetap berjalan setelah permintaan gagal dan snapshot ringan tidak membaca ulang seluruh backup', async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-queue-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const controller = await new BackupController({ stateDirectory: path.join(root, 'state'), getGames: async () => [] }).init();
  await controller.configure({ destination: path.join(root, 'cloud') });
  const failed = assert.rejects(controller.manual('missing', [{ path: root }]), /tidak tersedia/);
  const next = controller.configure({ retention: 5 });
  await Promise.all([failed, next]);
  controller.engine.versions = async () => { throw new Error('Heavy history read'); };
  const view = await controller.snapshot('steam:1', true);
  assert.equal(view.retention, 5);
  assert.equal(view.operations.length, 0);
  await assert.rejects(controller.snapshot('steam:1'), /Heavy history/);
});

test('backup manual tidak bentrok dengan polling dan status selesai bertahan saat isi tidak berubah', async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-queue-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'save.sav');
  await fs.writeFile(file, 'progress');
  const controller = await new BackupController({ stateDirectory: path.join(root, 'state'), stableMs: 1, getGames: async () => [{ id: 'steam:1' }] }).init();
  await controller.configure({ destination: path.join(root, 'cloud'), enabled: true });
  await controller.manual('steam:1', [{ path: file }]);
  await Promise.all([controller.backup('steam:1'), controller.tick()]);
  const completed = (await controller.snapshot('steam:1')).lastOperation;
  await controller.tick();
  assert.deepEqual((await controller.snapshot('steam:1')).lastOperation, completed);
  assert.equal((await controller.snapshot('steam:1')).versions.length, 1);
  await controller.backup('steam:1');
  assert.match((await controller.snapshot('steam:1')).lastOperation.detail, /tidak berubah/);
});

test('tray idle skips repeated hashing, while running games, foreground and manual requests remain immediate', async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-idle-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'save.sav');
  await fs.writeFile(file, 'one');
  let background = true, running = false;
  const controller = await new BackupController({ stateDirectory: path.join(root, 'state'), stableMs: 1, isBackground: () => background, getGames: async () => [{ id: 'steam:1', running }] }).init();
  await controller.configure({ enabled: true, destination: path.join(root, 'cloud') });
  await controller.manual('steam:1', [{ path: file }]);
  await controller.tick();
  const scan = controller.engine.scan.bind(controller.engine);
  let scans = 0;
  controller.engine.scan = async roots => { scans++; return scan(roots); };
  await fs.writeFile(file, 'two');
  await controller.tick();
  assert.equal(scans, 0);
  await controller.backup('steam:1', 'game-closed');
  assert.equal((await controller.snapshot('steam:1')).versions.length, 2);
  scans = 0;
  running = true;
  await controller.tick();
  assert.ok(scans > 0);
  scans = 0;
  running = false; background = false;
  await controller.tick();
  assert.ok(scans > 0);
  background = true;
  controller.lastAutomaticScan = Date.now() - 30001;
  await fs.writeFile(file, 'three');
  await controller.tick();
  assert.equal((await controller.snapshot('steam:1')).versions.length, 3);
});

test('unchanged settings do not replace the settings file on idle polls', async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-idle-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const controller = await new BackupController({ stateDirectory: root, getGames: async () => [] }).init();
  await controller.configure({ enabled: true, destination: path.join(root, 'cloud') });
  const before = await fs.stat(controller.file);
  await controller.tick();
  await controller.save();
  const after = await fs.stat(controller.file);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.ino, before.ino);
  await controller.configure({ retention: 20 });
  assert.equal(JSON.parse(await fs.readFile(controller.file, 'utf8')).retention, 20);
});

test('progress polling reads only memory and returns detached operation data', async () => {
  const controller = new BackupController({ stateDirectory: '/unused', getGames: async () => { throw new Error('must not query library'); } });
  controller.state = { games: {} };
  controller.engine = { storage: () => { throw new Error('must not query storage'); }, recovery: () => { throw new Error('must not read journals'); } };
  const operation = controller.operation('backup', 'game', 'copying');
  controller.progress('game', 'copying', 3, 10);
  const first = controller.progressSnapshot('game');
  assert.equal(first.operations[0].completed, 3);
  controller.progress('game', 'copying', 4, 10);
  assert.equal(first.operations[0].completed, 3);
  assert.equal(controller.progressSnapshot('game').operations[0].completed, 4);
  controller.operations.delete(operation.id);
  controller.rememberOperation({ kind: 'backup', gameId: 'game', status: 'complete', at: 'now' });
  const done = controller.progressSnapshot('game');
  assert.equal(done.operations.length, 0);
  done.lastOperation.status = 'failed';
  assert.equal(controller.progressSnapshot('game').lastOperation.status, 'complete');
});

test('save locations group files in one folder and retain separate configured directories', async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-folders-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const controller = await new BackupController({ stateDirectory: path.join(root, 'state'), getGames: async () => [] }).init();
  controller.state.games.game = { roots: [
    { id: 'one', kind: 'file', path: path.join(root, 'save', 'one.sav') },
    { id: 'two', kind: 'file', path: path.join(root, 'save', 'two.sav') },
    { id: 'folder', kind: 'directory', path: path.join(root, 'save') },
    { id: 'other', kind: 'directory', path: path.join(root, 'other') },
  ] };
  const snapshot = await controller.snapshot('game', true);
  assert.deepEqual(snapshot.saveFolders, [{ rootId: 'one', path: path.join(root, 'save') }, { rootId: 'other', path: path.join(root, 'other') }]);
  assert.equal(snapshot.roots.length, 4);
});
