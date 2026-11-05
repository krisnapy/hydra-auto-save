import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { BackupEngine, digest, makeRoots } from '../module/engine.mjs';
import { localPlan, optimizeLocal } from '../module/backup-optimization.mjs';
import { BackupController } from '../module/controller.mjs';
import { CloudSync } from '../module/cloud-sync.mjs';
import { packVersion } from '../module/cloud-bundle.mjs';
import { OneDrive } from '../module/onedrive.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-opt-'));
  const save = path.join(root, 'slot.sav'); await fs.writeFile(save, 'save');
  const roots = await makeRoots([{ path: save }]);
  const engine = new BackupEngine({ destination: path.join(root, 'backups'), stateDirectory: path.join(root, 'state'), deviceId: randomUUID(), retention: 100, stableMs: 1, assertStopped: async () => {} });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, save, roots, engine };
}
async function legacy(engine, roots, save, value) {
  await fs.writeFile(save, value.repeat(20000));
  const version = await engine.backup('steam:1', roots);
  const folder = path.join(engine.directory('steam:1'), version.id);
  for (const hash of version.compressed ?? []) {
    const file = path.join(folder, 'data', hash);
    await fs.writeFile(file, gunzipSync(await fs.readFile(file)));
  }
  const old = { ...version, schema: 1 }; delete old.compressed; delete old.storage;
  const text = JSON.stringify(old, null, 2);
  await fs.writeFile(path.join(folder, 'manifest.json'), text);
  await fs.writeFile(path.join(folder, 'COMPLETE'), digest(text));
  return old;
}

test('local preview is non-destructive; execution compresses old versions and prunes only confirmed normal history', async t => {
  const { engine, roots, save } = await fixture(t);
  const versions = [];
  for (let i = 0; i < 4; i++) versions.push(await legacy(engine, roots, save, `level-${i}`));
  const safety = await engine.backup('steam:1', roots, { safety: true });
  engine.retention = 2;
  const other = new BackupEngine({ ...engine, deviceId: randomUUID() });
  await other.backup('steam:1', roots);
  const plan = await localPlan(engine, ['steam:1']);
  assert.equal(plan.compress, 2); assert.equal(plan.remove, 2);
  assert.equal((await engine.versions('steam:1')).length, 5, 'preview never prunes');
  const result = await optimizeLocal(engine, ['steam:1'], plan.token);
  assert.equal(result.compressed, 2); assert.equal(result.removed, 2); assert.ok(result.savedBytes > 100000);
  const remaining = await engine.versions('steam:1', { fresh: true });
  assert.equal(remaining.length, 3); assert.ok(remaining.some(v => v.id === safety.id && v.safety));
  assert.equal((await other.versions('steam:1')).length, 1);
  const preserved = remaining.find(v => v.id === versions[2].id);
  assert.equal(preserved.createdAt, versions[2].createdAt);
  assert.equal(preserved.fingerprint, versions[2].fingerprint);
  await engine.restore('steam:1', roots, preserved.id, true);
  assert.equal(await fs.readFile(save, 'utf8'), 'level-2'.repeat(20000));
  assert.ok(!(await fs.readdir(engine.directory('steam:1'))).some(n => n.startsWith('_opt-')));
});

test('stale local preview, insufficient space and recovery journals do not delete old backups', async t => {
  const { engine, roots, save } = await fixture(t);
  await legacy(engine, roots, save, 'first');
  const plan = await localPlan(engine, ['steam:1']);
  await legacy(engine, roots, save, 'second');
  await assert.rejects(optimizeLocal(engine, ['steam:1'], plan.token), /berubah sejak/);
  const current = await localPlan(engine, ['steam:1']);
  engine.requireSpace = async () => { throw new Error('disk full'); };
  await assert.rejects(optimizeLocal(engine, ['steam:1'], current.token), /disk full/);
  assert.equal((await engine.versions('steam:1', { fresh: true })).length, 2);
  await fs.mkdir(engine.stateDirectory, { recursive: true });
  await fs.writeFile(engine.journal('steam:1'), '{}');
  await assert.rejects(localPlan(engine, ['steam:1']), /Pemulihan sebelumnya/);
});

test('restart repairs either directory-swap boundary, preserving a corrupt replacement for inspection', async t => {
  const { engine, roots, save } = await fixture(t);
  const version = await legacy(engine, roots, save, 'original');
  const folder = path.join(engine.directory('steam:1'), version.id);
  const old = path.join(engine.directory('steam:1'), `_opt-old-${version.id}`);
  await fs.rename(folder, old);
  const restarted = () => new BackupEngine({ ...engine });
  assert.equal((await restarted().versions('steam:1', { fresh: true })).length, 1);
  await fs.cp(folder, old, { recursive: true });
  await fs.writeFile(path.join(folder, 'COMPLETE'), 'interrupted');
  assert.equal((await restarted().versions('steam:1', { fresh: true })).length, 1);
  assert.ok((await fs.readdir(engine.directory('steam:1'))).some(n => n.startsWith('_opt-failed-')));
  // Crash after publishing a complete equivalent replacement: original may go.
  await fs.cp(folder, old, { recursive: true });
  assert.equal((await restarted().versions('steam:1', { fresh: true })).length, 1);
  await assert.rejects(fs.access(old), { code: 'ENOENT' });
});

async function cloudFixture(t) {
  const f = await fixture(t);
  const controller = await new BackupController({ stateDirectory: path.join(f.root, 'controller'), stableMs: 1, getGames: async () => [{ id: 'steam:1', title: 'Test game' }], assertStopped: async () => {} }).init();
  await controller.configure({ destination: f.engine.destination, retention: 100 });
  await controller.manual('steam:1', [{ path: f.save }]);
  const engine = controller.engine;
  const files = new Map();
  const versions = [];
  for (let i = 0; i < 4; i++) {
    await fs.writeFile(f.save, `level-${i}`);
    versions.push(await controller.backup('steam:1'));
  }
  versions.push(await engine.backup('steam:1', controller.state.games['steam:1'].roots, { safety: true }));
  for (const v of versions) {
    const bytes = await packVersion(engine, 'steam:1', v.id);
    const name = `${digest('steam:1')}_${engine.deviceId}_${v.id}_${digest(bytes)}.hpb`;
    files.set(name, { name, size: bytes.length, eTag: `"${v.id}"`, bytes });
  }
  const cloud = await new CloudSync({ directory: path.join(f.root, 'outbox'), controller, vault: { load: async () => null, save: async () => {} } }).init();
  cloud.connected = true; cloud.state.driveId = 'A'; engine.retention = 2;
  let downloads = 0; const removed = [];
  cloud.provider = {
    identity: async () => 'A',
    list: async () => [...files.values()].map(({ bytes, ...item }) => item),
    download: async name => { downloads++; return files.get(name).bytes; },
    remove: async (name, eTag) => {
      assert.equal(files.get(name)?.eTag, eTag);
      removed.push(name); files.delete(name);
    },
  };
  t.after(async () => { await cloud.stop(); await controller.stop(); });
  return { ...f, cloud, controller, engine, files, versions, removed, downloads: () => downloads };
}

test('cloud cleanup validates once, respects retention and safety, and never targets other PCs or games', async t => {
  const f = await cloudFixture(t);
  const foreign = [...f.files.values()][0];
  const name = foreign.name.replace(f.engine.deviceId, randomUUID());
  f.files.set(name, { ...foreign, name });
  const plan = await f.cloud.planOptimization('steam:1');
  assert.equal(plan.remove, 2); assert.equal(f.removed.length, 0);
  const reads = f.downloads();
  const result = await f.cloud.optimize(plan.token, 'steam:1');
  assert.equal(result.removed, 2); assert.equal(f.downloads(), reads, 'confirmation rechecks ETags without downloading again');
  assert.equal(f.files.size, 4, '2 normal + safety + foreign retained');
  assert.ok(f.files.has(name));
  assert.ok([...f.files.keys()].some(n => n.includes(f.versions.at(-1).id)));
  await assert.rejects(f.cloud.optimize(plan.token, 'steam:1'), /kedaluwarsa/);
});

test('cloud inventory/retention/account changes after preview abort without deleting', async t => {
  for (const change of ['etag', 'retention', 'account']) {
    const f = await cloudFixture(t);
    const plan = await f.cloud.planOptimization('steam:1');
    if (change === 'etag') [...f.files.values()][0].eTag = 'changed';
    if (change === 'retention') f.engine.retention = 3;
    if (change === 'account') f.cloud.provider.identity = async () => 'B';
    await assert.rejects(f.cloud.optimize(plan.token, 'steam:1'), /berubah|kedaluwarsa/);
    assert.equal(f.removed.length, 0);
  }
});

test('cloud corruption, missing ETags and pending packages are protected; offline never removes anything', async t => {
  const f = await cloudFixture(t);
  const items = [...f.files.values()];
  items[0].bytes = Buffer.from('corrupt');
  delete items[1].eTag;
  f.cloud.state.jobs.push({ name: items[2].name, driveId: 'A', gameId: 'steam:1', bytes: items[2].size, attempts: 0, nextAt: 0 });
  const plan = await f.cloud.planOptimization('steam:1');
  assert.equal(plan.remove, 0); assert.ok(plan.protectedCount >= 3);
  f.cloud.provider.download = async () => { throw new Error('offline'); };
  await assert.rejects(f.cloud.planOptimization('steam:1'), /offline/);
  assert.equal(f.removed.length, 0);
});

test('Graph deletion is scoped to app folder, conditional, and rejects invalid requests', async () => {
  const name = `${digest('steam:1')}_${randomUUID()}_version_${digest('bundle')}.hpb`;
  const calls = [];
  const provider = new OneDrive({ loadTokens: async () => ({ access: 'test-only', expiresAt: Date.now() + 1000000 }), saveTokens: async () => {}, fetcher: async (url, options) => { calls.push({ url, options }); return new Response(null, { status: 204 }); } });
  await provider.remove(name, '"etag"');
  assert.ok(calls[0].url.endsWith(`me/drive/special/approot:/${name}`));
  assert.equal(calls[0].options.method, 'DELETE'); assert.equal(calls[0].options.headers['If-Match'], '"etag"');
  await assert.rejects(provider.remove('../elsewhere', '"etag"'));
  await assert.rejects(provider.remove(name, ''));
  assert.equal(calls.length, 1);
});

test('new pending uploads and expired previews block cloud cleanup', async t => {
  for (const change of ['pending', 'expired']) {
    const f = await cloudFixture(t);
    const plan = await f.cloud.planOptimization('steam:1');
    if (change === 'expired') f.cloud.optimizationPreview.expiresAt = Date.now() - 1;
    else f.cloud.state.jobs.push({ name: plan.candidates[0].name, driveId: 'A', gameId: 'steam:1', bytes: plan.candidates[0].size, attempts: 0, nextAt: 0 });
    await assert.rejects(f.cloud.optimize(plan.token, 'steam:1'), /kedaluwarsa|berubah/);
    assert.equal(f.removed.length, 0);
  }
});

test('partial cloud cleanup reports the completed count and preserves unprocessed packages', async t => {
  const f = await cloudFixture(t);
  const plan = await f.cloud.planOptimization('steam:1');
  const remove = f.cloud.provider.remove;
  f.cloud.provider.remove = async (...args) => {
    if (f.removed.length) throw new Error('offline');
    await remove(...args);
  };
  await assert.rejects(f.cloud.optimize(plan.token, 'steam:1'), /1 versi sudah dipindahkan/);
  assert.equal(f.files.size, 4); assert.equal(f.removed.length, 1);
  assert.ok(f.files.has(plan.candidates[1].name));
  assert.equal(f.controller.lastOperation.status, 'failed');
});
