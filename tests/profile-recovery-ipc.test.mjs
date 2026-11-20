import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

async function harness({ confirm = false, cancelled = false, failQueue = false, legacy = false, kind = 'file', targetProfiles = [] } = {}) {
  let handler;
  const calls = [], dialogs = [], pickers = [];
  const roots = [{ id: 'r', kind, files: 1, target: '', path: 'C:/new-user/slot.sav' }];
  const recovery = {
    snapshot: () => ({ sources: [], selection: { token: 'main-token', gameId: 'steam:1', ownership: legacy ? 'legacy' : 'matched', title: 'Old Game', targetTitle: 'New Game', deviceId: 'old-device', createdAt: '2026-11-19', targetProfiles, roots } }),
    targets: async token => { assert.equal(token, 'main-token'); return roots; },
    listLocal: async dir => { calls.push(['local', dir]); return recovery.snapshot(); },
    details: token => { calls.push(['details', token]); return recovery.snapshot(); },
    select: async token => { calls.push(['select', token]); return recovery.snapshot(); },
    chooseTargetProfile: (...args) => { calls.push(['profile', ...args]); },
    map: async (...args) => { calls.push(['map', ...args]); return recovery.snapshot(); },
  };
  const modules = {
    'node:path': {}, 'node:fs/promises': {},
    electron: { app: { getPath: () => 'C:/Users/Current' }, shell: {}, dialog: {
      showMessageBox: async (_, options) => { dialogs.push(options); return { response: confirm ? 1 : 0 }; },
      showSaveDialog: async (_, options) => { pickers.push(options); return { canceled: cancelled, filePath: 'C:/native-picker/slot.sav' }; },
      showOpenDialog: async (_, options) => { pickers.push(options); return { canceled: cancelled, filePaths: ['D:/native-picker'] }; },
    } },
    './register-event': { registerEvent: (_, callback) => { handler = callback; } },
    './epic/assert-trusted-sender': { assertTrustedEpicSender: event => { if (!event.trusted) throw new Error('untrusted'); } },
    '../services/window-manager': { WindowManager: { mainWindow: {} } },
    '../services/personal-cloud-backup': {
      getPersonalBackup: async () => ({}), getProfileRecovery: async () => recovery,
      getProfileRestoreQueue: () => ({
        enqueue: (session, ...args) => {
          assert.equal(session, recovery);
          calls.push(['enqueue', ...args]);
          if (failQueue) throw new Error('changed targets');
        },
        snapshot: gameId => [{ id: 'job', gameId, status: 'waiting' }],
        cancel: (...args) => calls.push(['cancel', ...args]),
      }),
    },
    '../services/personal-cloud-backup/onedrive': {},
  };
  const source = await readFile(new URL('../integration/overlay/src/main/events/personal-cloud-backup.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: {}, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  return { calls, dialogs, pickers, roots, invoke: request => handler({ trusted: true }, { action: 'profile-recovery', gameId: 'steam:1', ...request }), handler };
}

test('old profile restore requires native confirmation and queues only the confirmed server targets', async () => {
  const cancelled = await harness();
  await cancelled.invoke({ command: 'restore', token: 'main-token', targets: ['forged'] });
  assert.deepEqual(cancelled.calls, []);
  assert.equal(cancelled.dialogs[0].defaultId, 0);
  const h = await harness({ confirm: true });
  await assert.rejects(h.invoke({ command: 'restore', token: 'main-token', gameId: 'forged-game' }), /Game tujuan berubah/);
  await h.invoke({ command: 'restore', token: 'main-token', gameId: 'steam:1', versionId: 'forged-version' });
  assert.deepEqual(h.calls, [['enqueue', 'main-token', JSON.stringify(h.roots)]]);
  assert.match(h.dialogs[0].message, /Old Game.*New Game/);
  assert.match(h.dialogs[0].detail, /C:\/new-user\/slot.sav/);
  const failed = await harness({ confirm: true, failQueue: true });
  await assert.rejects(failed.invoke({ command: 'restore', token: 'main-token' }), /changed targets/);
});

test('native restore confirmation summarizes large destination lists and queues every location', async () => {
  const h = await harness({ confirm: true });
  for (let i = 1; i < 993; i++) {
    h.roots.push({ ...h.roots[0], id: `r-${i}`, path: `C:/new-user/slot-${i}.sav` });
  }
  await h.invoke({ command: 'restore', token: 'main-token' });
  assert.match(h.dialogs[0].detail, /993 lokasi/);
  assert.match(h.dialogs[0].detail, /981 lokasi lainnya/);
  assert.doesNotMatch(h.dialogs[0].detail, /slot-992\.sav/);
  assert.deepEqual(h.calls, [['enqueue', 'main-token', JSON.stringify(h.roots)]]);
});

test('source and target paths come from native pickers; cancellation and untrusted senders cannot map or restore', async () => {
  const h = await harness();
  await h.invoke({ command: 'local', path: 'C:/forged' });
  await h.invoke({ command: 'map', token: 'main-token', rootId: 'r', path: 'C:/forged' });
  assert.deepEqual(h.calls, [['local', 'D:/native-picker'], ['map', 'main-token', 'r', 'C:/native-picker/slot.sav']]);
  assert.equal(h.pickers[1].defaultPath, 'C:/Users/Current');
  const folder = await harness({ kind: 'directory' });
  await folder.invoke({ command: 'map', token: 'main-token', rootId: 'r' });
  assert.equal(folder.pickers[0].defaultPath, 'C:/Users/Current');
  assert.deepEqual([...folder.pickers[0].properties], ['openDirectory']);
  const c = await harness({ cancelled: true });
  await c.invoke({ command: 'local' });
  await c.invoke({ command: 'map', token: 'main-token', rootId: 'r' });
  assert.deepEqual(c.calls, []);
  await assert.rejects(h.invoke({ command: 'map', token: 'main-token', rootId: 'forged' }), /Pilih ulang/);
  await assert.rejects(h.handler({ trusted: false }, { action: 'profile-recovery', command: 'restore' }), /untrusted/);
});


test('unowned backup is linked only through explicit native claim confirmation', async () => {
  const h = await harness({ confirm: true, legacy: true });
  await h.invoke({ command: 'restore', token: 'main-token' });
  assert.equal(h.dialogs[0].buttons[1], 'Tautkan dan pulihkan');
  assert.match(h.dialogs[0].detail, /belum mencatat pemilik/);
  assert.equal(h.calls[0][0], 'enqueue');
});

test('one profile opens confirmation automatically; multiple profiles wait for a selected token', async () => {
  const first = { token: 'a', name: '200' };
  const second = { token: 'b', name: '300' };
  const single = await harness({ targetProfiles: [first] });
  await single.invoke({ command: 'select', token: 'backup' });
  assert.equal(single.dialogs.length, 1);
  assert.deepEqual(single.calls, [['select', 'backup']]);
  const multi = await harness({ confirm: true, targetProfiles: [first, second] });
  await multi.invoke({ command: 'select', token: 'backup' });
  assert.equal(multi.dialogs.length, 0);
  await multi.invoke({ command: 'restore', token: 'main-token', targetProfile: second.token, path: 'forged/path' });
  assert.equal(multi.dialogs.length, 1);
  assert.deepEqual(multi.calls, [['select', 'backup'], ['profile', 'main-token', 'b'], ['enqueue', 'main-token', JSON.stringify(multi.roots)]]);
});

test('settings opens profile details and restores the matching game resolved by the main process', async () => {
  const h = await harness({ confirm: true });
  await h.invoke({ command: 'details', gameId: undefined, token: 'profile' });
  await h.invoke({ command: 'select', gameId: undefined, token: 'backup', targetGameId: 'other-game' });
  await h.invoke({ command: 'restore', gameId: undefined, token: 'main-token', targetGameId: 'other-game' });
  assert.deepEqual(h.calls, [
    ['details', 'profile'], ['select', 'backup'],
    ['enqueue', 'main-token', JSON.stringify(h.roots)],
  ]);
});

test('deferred restore confirms intent without a destination and exposes account-scoped cancellation', async () => {
  const declined = await harness();
  await declined.invoke({ command: 'defer', token: 'main-token' });
  assert.deepEqual(declined.calls, []);
  const h = await harness({ confirm: true, legacy: true });
  await h.invoke({ command: 'defer', token: 'main-token', targets: ['forged'] });
  assert.match(h.dialogs[0].detail, /buka game, buat save pertama, lalu tutup game/);
  assert.match(h.dialogs[0].detail, /penautan/);
  assert.deepEqual(h.calls, [['enqueue', 'main-token']]);
  const [job] = await h.invoke({ command: 'pending' });
  await h.invoke({ command: 'cancel-pending', jobId: job.id });
  assert.deepEqual(h.calls.at(-1), ['cancel', 'job', 'steam:1']);
});
