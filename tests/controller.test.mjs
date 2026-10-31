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
