import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { SaveMonitor } from '../module/save-monitor.mjs';
import { BackupController } from '../module/controller.mjs';

async function files(t) {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-monitor-'));
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups) await cleanup();
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  const save = path.join(directory, 'save.sav');
  await fs.writeFile(save, 'first');
  return { directory, save, cleanup: callback => cleanups.push(callback) };
}
async function waitFor(check, timeout = 6000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await delay(20); }
  throw new Error('Timed out waiting for backup.');
}

test('native save monitor observes atomic file replacement and closes its watchers', async t => {
  const { directory, save, cleanup } = await files(t);
  const events = [];
  const monitor = new SaveMonitor(id => events.push(id));
  cleanup(() => monitor.close());
  await monitor.sync({ game: [{ id: 'root', path: save, kind: 'file' }] });
  assert.equal(monitor.healthy('game'), true);
  const replacement = path.join(directory, 'temp.sav');
  await fs.writeFile(replacement, 'replacement');
  await fs.rename(replacement, save);
  await waitFor(() => events.includes('game'));
  await monitor.sync({});
  assert.equal(monitor.entries.size, 0);
});

test('event bursts coalesce into one version, unchanged heartbeats skip hashing, periodic fallback catches lost events', async t => {
  const { directory, save, cleanup } = await files(t);
  let notify;
  const monitor = { sync: async () => {}, healthy: () => true, close: () => {} };
  const controller = await new BackupController({ stateDirectory: path.join(directory, 'state'), stableMs: 5, debounceMs: 80, pollMs: 20, fallbackMs: 100000, getGames: async () => [{ id: 'game', title: 'Game' }], monitorFactory: callback => { notify = callback; return monitor; } }).init();
  cleanup(() => controller.stop());
  await controller.configure({ enabled: true, destination: path.join(directory, 'cloud') });
  await controller.manual('game', [{ path: save }]);
  controller.start();
  await waitFor(async () => (await controller.snapshot('game')).versions.length === 1);
  const original = controller.engine.scan.bind(controller.engine);
  let scans = 0;
  controller.engine.scan = async roots => { scans++; return original(roots); };
  await delay(100);
  assert.equal(scans, 0);
  for (const content of ['second', 'third', 'fourth']) { await fs.writeFile(save, content); notify('game'); await delay(15); }
  await waitFor(async () => (await controller.snapshot('game')).versions.length === 2);
  await delay(100);
  assert.equal((await controller.snapshot('game')).versions.length, 2);
  await fs.writeFile(save, 'lost event');
  controller.lastScan.set('game', Date.now() - 100001);
  await waitFor(async () => (await controller.snapshot('game')).versions.length === 3);
});

test('unsupported watcher falls back to periodic scans and stop releases monitor resources', async t => {
  const { directory, save, cleanup } = await files(t);
  let closed = 0;
  const controller = await new BackupController({ stateDirectory: path.join(directory, 'state'), stableMs: 1, debounceMs: 5, pollMs: 20, monitorFactory: () => ({ sync: async () => {}, healthy: () => false, close: () => { closed++; } }), getGames: async () => [{ id: 'game' }] }).init();
  cleanup(() => controller.stop());
  await controller.configure({ enabled: true, destination: path.join(directory, 'cloud') });
  await controller.manual('game', [{ path: save }]);
  controller.start();
  await waitFor(async () => (await controller.snapshot('game')).versions.length === 1);
  await fs.writeFile(save, 'no watcher');
  await waitFor(async () => (await controller.snapshot('game')).versions.length === 2);
  await controller.stop();
  assert.ok(closed > 0);
});

test('guided setup cannot complete before a successful backup and resets when destination changes', async t => {
  const { directory, save, cleanup } = await files(t);
  const controller = await new BackupController({ stateDirectory: path.join(directory, 'state'), stableMs: 1, getGames: async () => [{ id: 'game', title: 'Game' }] }).init();
  await controller.configure({ destination: path.join(directory, 'cloud') });
  await assert.rejects(controller.configure({ enabled: true, setupCompleted: true }), /backup percobaan/);
  await controller.manual('game', [{ path: save }]);
  await controller.backup('game');
  await controller.configure({ enabled: true, setupCompleted: true });
  assert.equal((await controller.snapshot()).setup.completed, true);
  await controller.configure({ destination: path.join(directory, 'cloud-two') });
  const view = await controller.snapshot();
  assert.equal(view.setup.completed, false);
  assert.equal(view.setup.firstBackupAt, undefined);
});

test('directory replacement rebuilds recursive monitoring for new nested save files', async t => {
  const { directory, cleanup } = await files(t);
  const root = path.join(directory, 'folder');
  await fs.mkdir(root);
  const events = [];
  const monitor = new SaveMonitor(id => events.push(id));
  cleanup(() => monitor.close());
  const configurations = { game: [{ path: root, kind: 'directory', id: 'root' }] };
  await monitor.sync(configurations);
  await fs.rename(root, `${root}-old`);
  await fs.mkdir(root);
  await waitFor(() => events.length > 0);
  await monitor.sync(configurations);
  await fs.mkdir(path.join(root, 'nested'));
  await delay(30);
  await monitor.sync(configurations);
  events.length = 0;
  await fs.writeFile(path.join(root, 'nested', 'new.sav'), 'nested progress');
  await waitFor(() => events.length > 0);
});

test('unstable save is retried without marking automatic backup as failed', async t => {
  const { directory, save, cleanup } = await files(t);
  const errors = [];
  const controller = await new BackupController({ stateDirectory: path.join(directory, 'state'), stableMs: 1, getGames: async () => [{ id: 'game' }], onError: error => errors.push(error) }).init();
  await controller.configure({ enabled: true, destination: path.join(directory, 'cloud') });
  await controller.manual('game', [{ path: save }]);
  const backup = controller.engine.backup.bind(controller.engine);
  let once = true;
  controller.engine.backup = async (...args) => {
    if (once) { once = false; throw Object.assign(new Error('Save sedang ditulis'), { code: 'SAVE_UNSTABLE' }); }
    return backup(...args);
  };
  await controller.tick();
  assert.equal((await controller.snapshot('game')).status.status, 'waiting');
  assert.equal(errors.length, 0);
  assert.equal(controller.dirty.has('game'), true);
  await controller.tick();
  assert.equal((await controller.snapshot('game')).versions.length, 0, 'backoff prevents immediate rescan');
  controller.unstableRetries.get('game').nextAt = 0;
  await controller.tick();
  assert.equal((await controller.snapshot('game')).versions.length, 1);
  assert.equal(controller.unstableRetries.has('game'), false);
  await controller.stop();
});

test('unstable game backs off to sixty seconds without blocking other games and manual backup bypasses the delay', async t => {
  const { directory, save, cleanup } = await files(t);
  const controller = await new BackupController({ stateDirectory: path.join(directory, 'state'), stableMs: 1, getGames: async () => [{ id: 'busy' }, { id: 'other' }] }).init();
  cleanup(() => controller.stop());
  await controller.configure({ enabled: true, destination: path.join(directory, 'cloud') });
  await controller.manual('busy', [{ path: save }]);
  await controller.manual('other', [{ path: save }]);
  const backup = controller.engine.backup.bind(controller.engine);
  let allow = false, calls = 0;
  controller.engine.backup = async (gameId, ...args) => {
    if (gameId === 'busy') {
      calls++;
      if (!allow) throw Object.assign(new Error('still writing'), { code: 'SAVE_UNSTABLE' });
    }
    return backup(gameId, ...args);
  };
  for (let attempt = 1; attempt <= 6; attempt++) {
    if (attempt > 1) controller.unstableRetries.get('busy').nextAt = 0;
    const started = Date.now();
    await controller.tick();
    const retry = controller.unstableRetries.get('busy');
    assert.equal(retry.attempts, attempt);
    const expected = Math.min(60000, 5000 * 2 ** Math.min(attempt - 1, 4));
    assert.ok(retry.nextAt >= started + expected);
    assert.ok(retry.nextAt <= Date.now() + expected);
  }
  assert.equal((await controller.snapshot('other')).versions.length, 1);
  await controller.tick();
  assert.equal(calls, 6, 'automatic retry cannot bypass the backoff');
  allow = true;
  await controller.backup('busy', 'game-closed');
  assert.equal(calls, 7);
  assert.equal(controller.unstableRetries.has('busy'), false);
  assert.equal((await controller.snapshot('busy')).versions.length, 1);
});
