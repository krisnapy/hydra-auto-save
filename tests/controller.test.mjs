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
