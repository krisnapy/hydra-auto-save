import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildWindows } from '../scripts/build-windows.mjs';

async function setup(t) {
  const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hydra-build-'));
  t.after(() => fs.rm(reportDir, { recursive: true, force: true }));
  return reportDir;
}

test('typechecking overlaps compilation; quick packaging waits for both', async t => {
  const reportDir = await setup(t);
  const active = new Map();
  let packaging;
  const result = buildWindows('.', { reportDir, run: async args => {
    if (args[0] === 'electron-builder') { packaging = args; return; }
    await new Promise(resolve => active.set(args[0], resolve));
  } });
  while (active.size < 2) await new Promise(resolve => setImmediate(resolve));
  assert.equal(packaging, undefined);
  active.get('electron-vite')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(packaging, undefined, 'typecheck must finish before packaging');
  active.get('typecheck')();
  const report = await result;
  assert.ok(packaging.includes('--dir'));
  assert.equal(report.passed, true);
});

test('failed typecheck blocks installer and writes failure timings', async t => {
  const reportDir = await setup(t);
  const called = [];
  await assert.rejects(buildWindows('.', { reportDir, mode: 'installer', run: async args => {
    called.push(args[0]);
    if (args[0] === 'typecheck') throw new Error('invalid types');
  } }), /validation failed/);
  assert.equal(called.includes('electron-builder'), false);
  const report = JSON.parse(await fs.readFile(path.join(reportDir, 'build-timings.json'), 'utf8'));
  assert.equal(report.passed, false);
  assert.equal(report.stages.find(stage => stage.name === 'typecheck').passed, false);
});

test('installer preserves both configured targets and accepts explicit store benchmark', async t => {
  const reportDir = await setup(t);
  let packaged;
  await buildWindows('.', { reportDir, mode: 'installer', compression: 'store', run: async (args, options) => {
    if (args[0] === 'electron-builder') packaged = { args, options };
  } });
  assert.equal(packaged.args.includes('--dir'), false);
  assert.equal(packaged.options.env.HYDRA_BUILD_COMPRESSION, 'store');
  await assert.rejects(buildWindows('.', { reportDir, mode: 'anything' }), /Unknown/);
  await assert.rejects(buildWindows('.', { reportDir, compression: 'anything' }), /Unknown/);
});
