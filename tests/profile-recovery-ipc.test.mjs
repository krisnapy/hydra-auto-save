import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

async function harness({ confirm = false, cancelled = false, failImport = false, legacy = false } = {}) {
  let handler;
  const calls = [], dialogs = [];
  const roots = [{ id: 'r', kind: 'file', files: 1, target: 'C:/new-user/slot.sav', path: 'C:/new-user/slot.sav' }];
  const recovery = {
    snapshot: () => ({ sources: [], selection: { token: 'main-token', gameId: 'steam:1', ownership: legacy ? 'legacy' : 'matched', title: 'Old Game', targetTitle: 'New Game', deviceId: 'old-device', createdAt: '2026-11-19', roots } }),
    targets: async token => { assert.equal(token, 'main-token'); return roots; },
    listLocal: async dir => { calls.push(['local', dir]); return recovery.snapshot(); },
    map: async (...args) => { calls.push(['map', ...args]); return recovery.snapshot(); },
    import: async (...args) => { calls.push(['import', ...args]); if (failImport) throw new Error('changed targets'); return { gameId: 'steam:1', versionId: 'imported-version' }; },
  };
  const modules = {
    'node:path': {}, 'node:fs/promises': {},
    electron: { shell: {}, dialog: {
      showMessageBox: async (_, options) => { dialogs.push(options); return { response: confirm ? 1 : 0 }; },
      showSaveDialog: async () => ({ canceled: cancelled, filePath: 'C:/native-picker/slot.sav' }),
      showOpenDialog: async () => ({ canceled: cancelled, filePaths: ['D:/native-picker'] }),
    } },
    './register-event': { registerEvent: (_, callback) => { handler = callback; } },
    './epic/assert-trusted-sender': { assertTrustedEpicSender: event => { if (!event.trusted) throw new Error('untrusted'); } },
    '../services/window-manager': { WindowManager: { mainWindow: {} } },
    '../services/personal-cloud-backup': { getPersonalBackup: async () => ({}), getProfileRecovery: async () => recovery, restorePersonalBackup: async (...args) => calls.push(['restore', ...args]) },
    '../services/personal-cloud-backup/onedrive': {},
  };
  const source = await readFile(new URL('../integration/overlay/src/main/events/personal-cloud-backup.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: {}, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  return { calls, dialogs, roots, invoke: request => handler({ trusted: true }, { action: 'profile-recovery', gameId: 'steam:1', ...request }), handler };
}

test('old profile restore requires native confirmation and imports only the confirmed server targets before guarded restore', async () => {
  const cancelled = await harness();
  await cancelled.invoke({ command: 'restore', token: 'main-token', targets: ['forged'] });
  assert.deepEqual(cancelled.calls, []);
  assert.equal(cancelled.dialogs[0].defaultId, 0);
  const h = await harness({ confirm: true });
  await assert.rejects(h.invoke({ command: 'restore', token: 'main-token', gameId: 'forged-game' }), /Game tujuan berubah/);
  const result = await h.invoke({ command: 'restore', token: 'main-token', gameId: 'steam:1', versionId: 'forged-version' });
  assert.deepEqual(h.calls, [['import', 'main-token', JSON.stringify(h.roots), false], ['restore', 'steam:1', 'imported-version']]);
  assert.match(h.dialogs[0].message, /Old Game.*New Game/);
  assert.match(h.dialogs[0].detail, /C:\/new-user\/slot.sav/);
  assert.match(result.notice, /berhasil/);
  const failed = await harness({ confirm: true, failImport: true });
  await assert.rejects(failed.invoke({ command: 'restore', token: 'main-token' }), /changed targets/);
  assert.ok(!failed.calls.some(c => c[0] === 'restore'));
});

test('source and target paths come from native pickers; cancellation and untrusted senders cannot map or restore', async () => {
  const h = await harness();
  await h.invoke({ command: 'local', path: 'C:/forged' });
  await h.invoke({ command: 'map', token: 'main-token', rootId: 'r', path: 'C:/forged' });
  assert.deepEqual(h.calls, [['local', 'D:/native-picker'], ['map', 'main-token', 'r', 'C:/native-picker/slot.sav']]);
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
  assert.equal(h.calls[0][3], true);
});
