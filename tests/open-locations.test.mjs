import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';

async function harness({ file = false, missing = false, failure = '' } = {}) {
  let handler;
  const calls = [];
  const snapshot = { saveFolders: [{ rootId: 'configured', path: file ? 'C:/save' : 'C:/save/my progress.sav' }], roots: [{ id: 'configured', path: 'C:/save/my progress.sav', kind: file ? 'file' : 'directory' }], backupDirectory: 'C:/cloud/game' };
  const controller = { snapshot: async (...args) => { calls.push(['snapshot', ...args]); return snapshot; } };
  const source = await readFile(new URL('../integration/overlay/src/main/events/personal-cloud-backup.ts', import.meta.url), 'utf8');
  const modules = {
    'node:path': { dirname: path.posix.dirname },
    'node:fs/promises': { stat: async path => { calls.push(['stat', path]); if (missing) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return { isFile: () => false, isDirectory: () => true }; } },
    electron: { dialog: {}, shell: { openPath: async path => { calls.push(['open', path]); return failure; }, showItemInFolder: path => calls.push(['reveal', path]) } },
    './register-event': { registerEvent: (_, callback) => { handler = callback; } },
    './epic/assert-trusted-sender': { assertTrustedEpicSender: event => { if (!event.trusted) throw new Error('untrusted'); } },
    '../services/window-manager': { WindowManager: { mainWindow: {} } },
    '../services/personal-cloud-backup/onedrive': {},
    '../services/personal-cloud-backup': { getPersonalBackup: async () => controller },
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports: {}, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  return { calls, invoke: input => handler({ trusted: true }, { gameId: 'steam:1', ...input }), handler };
}

test('Explorer opens configured save folders without revealing or executing individual files or trusting supplied paths', async () => {
  const h = await harness();
  await h.invoke({ action: 'open-save', rootId: 'configured', path: 'C:/untrusted.exe' });
  await h.invoke({ action: 'open-backup' });
  assert.deepEqual(h.calls.filter(c => c[0] === 'open'), [['open', 'C:/save/my progress.sav'], ['open', 'C:/cloud/game']]);
  assert.ok(h.calls.filter(c => c[0] === 'snapshot').every(c => c[2] === true));
  await assert.rejects(h.invoke({ action: 'open-save', rootId: 'other' }), /belum diatur/);
  await assert.rejects(h.handler({ trusted: false }, { action: 'open-backup' }), /untrusted/);
  const f = await harness({ file: true });
  await f.invoke({ action: 'open-save', rootId: 'configured' });
  assert.deepEqual(f.calls.filter(c => ['open', 'reveal'].includes(c[0])), [['open', 'C:/save']]);
});

test('missing locations and Explorer failures are reported instead of creating folders', async () => {
  const h = await harness({ missing: true });
  await assert.rejects(h.invoke({ action: 'open-save', rootId: 'configured' }), /tidak ditemukan/);
  await assert.rejects(h.invoke({ action: 'open-backup' }), /Buat backup terlebih dahulu/);
  assert.ok(!h.calls.some(c => ['open', 'reveal'].includes(c[0])));
  const f = await harness({ failure: 'Access denied' });
  await assert.rejects(f.invoke({ action: 'open-backup' }), /Tidak dapat membuka folder: Access denied/);
});
