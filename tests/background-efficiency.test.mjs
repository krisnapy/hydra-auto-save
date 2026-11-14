import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const flush = () => new Promise(done => setImmediate(done));
function clock() {
  let now = 1000000, serial = 0;
  const timers = new Map();
  return {
    timers, Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const until = now + ms;
      while (true) {
        const next = [...timers].filter(([, value]) => value.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
      }
      now = until; await flush();
    },
  };
}
async function loadClass(file, name, timer) {
  const source = (await readFile(new URL(`../module/${file}`, import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(`export class ${name}`, `class ${name}`);
  const context = { ...timer, SaveMonitor: class { close() {} }, randomUUID: () => 'test', console };
  vm.runInNewContext(`${source}\nthis.result = ${name};`, context);
  return context.result;
}

test('cloud sleeps with empty queue, wakes for due work, honors retry deadline and sleeps after completion', async () => {
  const timer = clock(), CloudSync = await loadClass('cloud-sync.mjs', 'CloudSync', timer);
  const cloud = new CloudSync({});
  cloud.connected = true; cloud.state = { driveId: 'A', jobs: [] };
  let runs = 0;
  cloud.run = async () => {
    runs++;
    if (runs === 1) cloud.state.jobs[0].nextAt = timer.Date.now() + 60000;
    else cloud.state.jobs[0].uploadedAt = 'done';
  };
  cloud.startTimer(); await timer.advance(120000);
  assert.equal(runs, 0); assert.equal(timer.timers.size, 0);
  cloud.state.jobs.push({ driveId: 'B', nextAt: 0 }); cloud.startTimer();
  assert.equal(timer.timers.size, 0, 'another account never wakes uploads');
  cloud.state.jobs.unshift({ driveId: 'A', nextAt: 0 }); cloud.startTimer();
  await timer.advance(5000); assert.equal(runs, 1);
  await timer.advance(59999); assert.equal(runs, 1);
  await timer.advance(1); assert.equal(runs, 2);
  assert.equal(timer.timers.size, 0);
  cloud.login = { expiresAt: timer.Date.now() + 60000 }; cloud.nextLoginAt = timer.Date.now() + 10000;
  cloud.startTimer(); assert.equal(timer.timers.size, 1);
  await cloud.stop(); assert.equal(timer.timers.size, 0);
});

test('tray heartbeat slows while idle but save changes wake before the idle deadline', async () => {
  const timer = clock(), Controller = await loadClass('controller.mjs', 'BackupController', timer);
  let background = true, running = false, calls = 0;
  const controller = new Controller({ isBackground: () => background });
  controller.state = { enabled: true };
  controller.tick = async () => { calls++; controller.hasRunningGames = running; };
  controller.start(); await timer.advance(1); assert.equal(calls, 1);
  await timer.advance(15000); assert.equal(calls, 1);
  controller.markChanged('game'); await timer.advance(1505); assert.equal(calls, 2);
  running = true; await timer.advance(13495); assert.equal(calls, 3);
  await timer.advance(5000); assert.equal(calls, 4, 'running game uses active heartbeat');
  running = false; background = false;
  await timer.advance(10000); assert.equal(calls, 6, 'foreground uses active heartbeat');
  await controller.stop(); assert.equal(timer.timers.size, 0);
});

for (const [file, component, props] of [
  ['personal-onedrive.tsx', 'PersonalOneDrive', {}],
  ['personal-cloud-backup.tsx', 'PersonalCloudBackup', {}],
]) test(`${component} releases all polling timers in tray and resumes once visible`, async () => {
  const source = await readFile(new URL(`../integration/overlay/src/renderer/src/components/${file}`, import.meta.url), 'utf8');
  const timer = clock(), effects = [], listeners = new Map();
  let calls = 0, resolve;
  const document = { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    ...timer, exports, document,
    window: { personalBackup: { invoke: () => { calls++; return new Promise(done => { resolve = done; }); } } },
    require: name => name === 'react' ? {
      useRef: value => ({ current: value }), useState: value => [value, () => {}],
      useEffect: fn => effects.push(fn), useCallback: fn => fn,
    } : name.endsWith('.scss') ? {} : name === './personal-onedrive' ? { PersonalOneDrive: () => null } : require(name),
  });
  exports[component](props); const cleanup = effects[0]();
  assert.equal(calls, 1);
  document.hidden = true; listeners.get('visibilitychange')();
  resolve({ provider: 'onedrive' }); await flush();
  assert.equal(timer.timers.size, 0, 'in-flight response cannot restart hidden polling');
  await timer.advance(60000); assert.equal(calls, 1);
  document.hidden = false; listeners.get('visibilitychange')(); assert.equal(calls, 2);
  resolve({ provider: 'onedrive' }); await flush(); assert.equal(timer.timers.size, 1);
  document.hidden = true; listeners.get('visibilitychange')(); assert.equal(timer.timers.size, 0);
  document.hidden = false; listeners.get('visibilitychange')(); assert.equal(calls, 3);
  cleanup(); resolve({ provider: 'onedrive' }); await flush();
  assert.equal(timer.timers.size, 0); assert.equal(listeners.size, 0);
});
