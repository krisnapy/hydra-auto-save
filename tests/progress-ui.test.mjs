import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
test('progress panel polls serially, skips unchanged renders and sleeps while hidden or unmounted', async () => {
  const source = await readFile(new URL('../integration/overlay/src/renderer/src/components/personal-cloud-backup.tsx', import.meta.url), 'utf8');
  const effects = [], updates = [], timers = new Map(), listeners = new Map();
  let timerId = 0, calls = 0, resolve;
  const document = { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const exports = {};
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(compiled, {
    exports, document,
    window: { personalBackup: { invoke: request => { assert.equal(request.action, 'progress'); calls++; return new Promise(done => { resolve = done; }); } } },
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    require: name => name === 'react' ? { useState: value => [value, update => updates.push(update)], useEffect: fn => effects.push(fn) } : name.endsWith('.scss') ? {} : require(name),
  });
  exports.BackupProgressPanel({ gameId: 'game', busy: false });
  const cleanup = effects[0]();
  const flush = () => new Promise(done => setImmediate(done));
  assert.equal(calls, 1);
  listeners.get('visibilitychange')();
  assert.equal(calls, 1, 'pending requests cannot overlap');
  const active = { operations: [{ id: 'one', phase: 'copying', total: 10, completed: 2 }] };
  resolve(active); await flush();
  assert.equal(updates.length, 1);
  let [id, timer] = [...timers][0];
  assert.equal(timer.delay, 250);
  timers.delete(id); timer.fn();
  resolve(active); await flush();
  assert.equal(updates.length, 1, 'identical progress must not rerender');
  document.hidden = true; listeners.get('visibilitychange')();
  assert.equal(timers.size, 0);
  document.hidden = false; listeners.get('visibilitychange')();
  resolve({ operations: [] }); await flush();
  assert.equal([...timers.values()][0].delay, 1000);
  listeners.get('visibilitychange')();
  const before = updates.length;
  cleanup(); resolve(active); await flush();
  assert.equal(updates.length, before, 'late response cannot update an unmounted panel');
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
});
