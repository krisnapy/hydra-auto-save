import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

async function harness({ confirm = false, empty = false, fail = false } = {}) {
  let handler;
  const calls = [], dialogs = [];
  const controller = {
    planOptimization: async id => { calls.push(['local-plan', id]); return { token: 'local-server-token', retention: 10, compress: empty ? 0 : 2, remove: empty ? 0 : 3, removableBytes: 4096 }; },
    optimize: async (...args) => { calls.push(['local-optimize', ...args]); if (fail) throw new Error('stale plan'); return { detail: 'local complete' }; },
    snapshot: async () => ({ versions: [] }),
  };
  const cloud = {
    planOptimization: async id => { calls.push(['cloud-plan', id]); return { token: 'cloud-server-token', retention: 10, remove: empty ? 0 : 3, removableBytes: 4096, protectedCount: 1 }; },
    optimize: async (...args) => { calls.push(['cloud-optimize', ...args]); if (fail) throw new Error('stale plan'); return { detail: 'cloud complete' }; },
    snapshot: () => ({ provider: 'onedrive', connected: true }),
  };
  const modules = {
    'node:path': {}, 'node:fs/promises': {},
    electron: { shell: {}, dialog: { showMessageBox: async (_, options) => { dialogs.push(options); return { response: confirm ? 1 : 0 }; } } },
    './register-event': { registerEvent: (_, callback) => { handler = callback; } },
    './epic/assert-trusted-sender': { assertTrustedEpicSender: event => { if (!event.trusted) throw new Error('untrusted'); } },
    '../services/window-manager': { WindowManager: { mainWindow: {} } },
    '../services/personal-cloud-backup': { getPersonalBackup: async () => controller },
    '../services/personal-cloud-backup/onedrive': { getOneDrive: async () => cloud, oneDriveCommand: action => action() },
  };
  const source = await readFile(new URL('../integration/overlay/src/main/events/personal-cloud-backup.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: {}, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  return { calls, dialogs, invoke: request => handler({ trusted: true }, request), handler };
}

for (const scope of ['local', 'cloud']) {
  const request = scope === 'local' ? { action: 'optimize' } : { action: 'cloud', command: 'optimize' };
  test(`${scope} optimization requires native confirmation and uses only the server preview token`, async () => {
    const cancelled = await harness();
    const response = await cancelled.invoke({ ...request, gameId: 'steam:1', token: 'forged', remove: ['arbitrary'] });
    assert.match(response.notice, /dibatalkan/);
    assert.deepEqual(cancelled.calls, [[`${scope}-plan`, 'steam:1']]);
    assert.equal(cancelled.dialogs[0].defaultId, 0); assert.equal(cancelled.dialogs[0].cancelId, 0);
    const confirmed = await harness({ confirm: true });
    const done = await confirmed.invoke({ ...request, token: 'forged', remove: ['arbitrary'] });
    assert.equal(done.notice, `${scope} complete`);
    assert.deepEqual(confirmed.calls.at(-1), [`${scope}-optimize`, `${scope}-server-token`, undefined]);
    await assert.rejects(confirmed.handler({ trusted: false }, request), /untrusted/);
  });
  test(`${scope} optimization no-op does not prompt, and execution errors are not reported as success`, async () => {
    const empty = await harness({ empty: true });
    await empty.invoke(request);
    assert.equal(empty.dialogs.length, 0);
    assert.equal(empty.calls.length, 1);
    const failed = await harness({ confirm: true, fail: true });
    await assert.rejects(failed.invoke(request), /stale plan/);
  });
}
