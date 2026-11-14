import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { BackupController } from '../module/controller.mjs';
import { CloudSync } from '../module/cloud-sync.mjs';
import { digest } from '../module/engine.mjs';
import { packVersion, splitSharedBundle, validateBundle, sharedObjectName } from '../module/cloud-bundle.mjs';
import { cloudName, objectName } from '../module/onedrive.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-shared-'));
  const save = path.join(root, 'save'); await fs.mkdir(save);
  await fs.writeFile(path.join(save, 'large.sav'), randomBytes(1024 ** 2));
  await fs.writeFile(path.join(save, 'slot.sav'), 'level-1');
  const controller = await new BackupController({ stateDirectory: path.join(root, 'state'), stableMs: 1, getGames: async () => [{ id: 'steam:1', title: 'Test' }], assertStopped: async () => {} }).init();
  await controller.configure({ destination: path.join(root, 'backups'), retention: 2 });
  await controller.manual('steam:1', [{ path: save }]);
  const cloud = await new CloudSync({ directory: path.join(root, 'outbox'), controller, vault: { load: async () => null, save: async () => {} } }).init();
  controller.onBackupCompleted = (engine, id, version) => cloud.backupCompleted(engine, id, version);
  cloud.connected = true; cloud.state.driveId = 'A';
  const files = new Map(), uploads = [], deletes = [];
  let serial = 0;
  cloud.provider = {
    identity: async () => 'A',
    upload: async (name, bytes) => {
      uploads.push(name); files.set(name, { name, bytes, size: bytes.length, eTag: `"${++serial}"`, lastModifiedDateTime: new Date().toISOString() });
    },
    download: async name => {
      if (!files.has(name)) throw Object.assign(new Error('missing'), { status: 404 });
      return files.get(name).bytes;
    },
    list: async (prefix, { objects = false } = {}) => [...files.values()].filter(item => item.name.startsWith(prefix) && (cloudName(item.name) || (objects && objectName(item.name)))).map(({ bytes, ...metadata }) => metadata),
    remove: async (name, tag) => { assert.equal(files.get(name).eTag, tag); deletes.push(name); files.delete(name); },
  };
  t.after(async () => { await cloud.stop(); await controller.stop(); await fs.rm(root, { recursive: true, force: true }); });
  const backup = async level => {
    await fs.writeFile(path.join(save, 'slot.sav'), level);
    const version = await controller.backup('steam:1');
    await cloud.tick();
    assert.equal(cloud.error, '');
    return version;
  };
  return { root, save, controller, cloud, files, uploads, deletes, backup };
}

test('shared versions upload unchanged files once, survive local deletion, and restore original bytes', async t => {
  const f = await fixture(t);
  const first = await f.backup('level-1');
  const firstLegacyBytes = (await packVersion(f.controller.engine, 'steam:1', first.id)).length;
  const storedFirst = [...f.files.values()].reduce((n, item) => n + item.size, 0);
  const second = await f.backup('level-2');
  const secondLegacyBytes = (await packVersion(f.controller.engine, 'steam:1', second.id)).length;
  const storedSecond = [...f.files.values()].reduce((n, item) => n + item.size, 0);
  assert.equal(f.uploads.filter(objectName).length, 3, 'one large shared file and two small changed files');
  assert.ok(storedSecond - storedFirst < 10000);
  t.diagnostic(JSON.stringify({ fixture: 'two versions, 1 MiB unchanged random save and changed small slot', legacyBytes: firstLegacyBytes + secondLegacyBytes, sharedBytes: storedSecond, secondVersionAdditionalBytes: storedSecond - storedFirst }));
  await fs.rm(f.controller.engine.directory('steam:1'), { recursive: true });
  await f.cloud.list('steam:1');
  const remote = f.cloud.snapshot('steam:1').versions.find(item => item.name.includes(first.id));
  await f.cloud.download('steam:1', remote.name);
  await f.controller.restore('steam:1', first.id, true);
  assert.equal(await fs.readFile(path.join(f.save, 'slot.sav'), 'utf8'), 'level-1');
  assert.ok((await f.controller.engine.versions('steam:1')).some(v => v.safety));
  assert.ok(second.id !== first.id);
});

test('retention is opt-in, trims old references and only their exclusive data, preserving safety and other PCs', async t => {
  const f = await fixture(t);
  const first = await f.backup('level-1');
  const second = await f.backup('level-2');
  await f.backup('level-3');
  assert.equal(f.deletes.length, 0);
  const safety = await f.controller.engine.backup('steam:1', f.controller.state.games['steam:1'].roots, { safety: true });
  await f.cloud.enqueue(f.controller.engine, 'steam:1', safety.id); await f.cloud.tick();
  const foreign = `${digest('steam:1')}_${randomUUID()}_foreign_${digest('foreign')}.hpb`;
  f.files.set(foreign, { name: foreign, bytes: Buffer.from('foreign'), size: 7, eTag: '"foreign"' });
  await f.cloud.setAutoRetention(true);
  await f.backup('level-4');
  assert.equal([...f.files.keys()].filter(name => cloudName(name) && !name.includes('foreign')).length, 3);
  assert.ok(f.deletes.some(name => name.includes(first.id)));
  assert.ok(f.deletes.some(name => name.includes(second.id)));
  assert.equal(f.deletes.filter(objectName).length, 2);
  assert.ok(f.files.has(foreign));
  assert.ok([...f.files.keys()].some(name => name.includes(safety.id)));
});

test('a failed upload never publishes a version; retry reuses verified objects and survives local retention', async t => {
  const f = await fixture(t);
  const version = await f.controller.backup('steam:1');
  const upload = f.cloud.provider.upload;
  let fail = true;
  f.cloud.provider.upload = async (name, bytes) => {
    if (fail && cloudName(name)) throw new Error('offline');
    return upload(name, bytes);
  };
  await f.cloud.tick();
  assert.equal([...f.files.keys()].filter(cloudName).length, 0);
  assert.equal(f.uploads.filter(objectName).length, 2);
  await fs.rm(f.controller.engine.directory('steam:1'), { recursive: true });
  fail = false; f.cloud.state.jobs[0].nextAt = 0;
  await f.cloud.tick();
  assert.equal(f.uploads.filter(objectName).length, 2);
  assert.ok(f.cloud.state.jobs[0].uploadedAt);
  assert.equal([...f.files.keys()].filter(cloudName).length, 1);
  assert.ok(version.id);
});

test('binary outbox validates length, hashes, decoded sizes and rejects trailing or corrupted bytes', async t => {
  const f = await fixture(t);
  const version = await f.controller.backup('steam:1');
  const engine = f.controller.engine, roots = f.controller.state.games['steam:1'].roots;
  const bytes = await packVersion(engine, 'steam:1', version.id, { shared: true });
  assert.equal((await validateBundle(engine, 'steam:1', roots, bytes)).manifest.id, version.id);
  const split = splitSharedBundle(bytes);
  assert.equal(split.objects.size, 2);
  assert.ok(objectName(sharedObjectName(split.value.manifest, split.value.objects[0])));
  for (const bad of [bytes.subarray(0, bytes.length - 1), Buffer.concat([bytes, Buffer.from('extra')])]) await assert.rejects(validateBundle(engine, 'steam:1', roots, bad));
  const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
  await assert.rejects(validateBundle(engine, 'steam:1', roots, corrupt));
  const wrongSize = Buffer.from(bytes);
  wrongSize.writeUInt32BE(0xffffffff, 5);
  await assert.rejects(validateBundle(engine, 'steam:1', roots, wrongSize));
});

test('corrupt or unknown cloud versions block shared-data cleanup and corruption blocks restoration', async t => {
  const f = await fixture(t);
  await f.backup('level-1');
  await f.backup('level-2');
  await f.backup('level-3');
  const badName = `${digest('steam:1')}_${f.controller.state.deviceId}_unknown_${digest('bad')}.hpb`;
  f.files.set(badName, { name: badName, bytes: Buffer.from('bad'), size: 3, eTag: '"bad"' });
  const plan = await f.cloud.planOptimization('steam:1');
  assert.equal(plan.objectCandidates.length, 0);
  await f.cloud.optimize(plan.token, 'steam:1');
  assert.ok(f.files.has(badName));
  assert.equal(f.deletes.filter(objectName).length, 0);
  const victim = [...f.files.values()].find(item => objectName(item.name) && item.bytes.length > 100);
  victim.bytes = Buffer.alloc(victim.bytes.length);
  await fs.rm(f.controller.engine.directory('steam:1'), { recursive: true });
  await f.cloud.list('steam:1');
  const version = f.cloud.snapshot('steam:1').versions.find(item => item.name !== badName);
  await assert.rejects(f.cloud.download('steam:1', version.name), /rusak/);
  assert.equal((await f.controller.engine.versions('steam:1')).length, 0);
});

test('pending uploads protect shared files, and changing inventory cancels cleanup after confirmation', async t => {
  const f = await fixture(t);
  await f.backup('level-1'); await f.backup('level-2'); await f.backup('level-3');
  await fs.writeFile(path.join(f.save, 'slot.sav'), 'pending');
  await f.controller.backup('steam:1');
  const pending = await f.cloud.planOptimization('steam:1');
  assert.equal(pending.objectCandidates.length, 0);
  // The captured version inventory is stale if another writer changes metadata.
  const item = [...f.files.values()].find(file => cloudName(file.name));
  item.eTag = '"changed"';
  await assert.rejects(f.cloud.optimize(pending.token, 'steam:1'), /berubah/);
  assert.equal(f.deletes.length, 0);
});

test('orphan files have a seven-day grace period and account changes disable automatic retention', async t => {
  const f = await fixture(t);
  await f.backup('level-1');
  const orphan = Buffer.from('an interrupted upload');
  const name = `${digest('steam:1')}_${f.controller.state.deviceId}_blob_${digest(orphan)}.hpd`;
  const item = { name, bytes: orphan, size: orphan.length, eTag: '"orphan"', lastModifiedDateTime: new Date().toISOString() };
  f.files.set(name, item);
  assert.equal((await f.cloud.planOptimization('steam:1')).unusedObjects, 0);
  item.lastModifiedDateTime = new Date(Date.now() - 8 * 86400000).toISOString();
  const plan = await f.cloud.planOptimization('steam:1');
  assert.equal(plan.unusedObjects, 1);
  await f.cloud.optimize(plan.token, 'steam:1'); assert.equal(f.files.has(name), false);
  await f.cloud.setAutoRetention(true);
  assert.equal(f.cloud.snapshot().autoRetention, true);
  f.cloud.state.driveId = 'B';
  assert.equal(f.cloud.snapshot().autoRetention, false);
});

test('legacy pending packages still upload after restart and cloud imports use adaptive local compression', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.save, 'large.sav'), 'compressible'.repeat(100000));
  const version = await f.controller.backup('steam:1');
  f.cloud.state.jobs = [];
  const legacy = await packVersion(f.controller.engine, 'steam:1', version.id);
  const name = `${digest('steam:1')}_${f.controller.state.deviceId}_${version.id}_${digest(legacy)}.hpb`;
  const job = { name, gameId: 'steam:1', driveId: 'A', bytes: legacy.length, nextAt: 0, attempts: 0 };
  await fs.writeFile(f.cloud.packageFile(job), legacy);
  f.cloud.state.jobs.push(job); await f.cloud.save();
  await f.cloud.tick(); assert.ok(job.uploadedAt);
  await fs.rm(f.controller.engine.directory('steam:1'), { recursive: true });
  await f.cloud.list('steam:1'); await f.cloud.download('steam:1', name);
  const imported = (await f.controller.engine.versions('steam:1', { fresh: true }))[0];
  assert.equal(imported.id, version.id); assert.equal(imported.schema, 2);
  assert.ok(imported.compressed.length > 0);
});
