import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { BackupEngine, makeRoots, digest } from '../module/engine.mjs';
import { packVersion, importVersion } from '../module/cloud-bundle.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-storage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const save = path.join(root, 'save'); await fs.mkdir(save);
  const engine = new BackupEngine({ destination: path.join(root, 'cloud'), deviceId: 'test-pc', stateDirectory: path.join(root, 'profile'), stableMs: 1, retention: 2, assertStopped: async () => {} });
  return { root, save, engine, roots: await makeRoots([{ path: save }]) };
}
const blob = (engine, version, entry = version.files[0]) => path.join(engine.directory('steam:1'), version.id, 'data', entry.hash);

// Large repeated data models text/JSON save files; random bytes model already
// compressed/encrypted saves. Neither is a claim about all real games.
test('compressible saves shrink, identical files share one blob, and incompressible files stay raw', async t => {
  const { save, engine, roots } = await fixture(t);
  const text = Buffer.from('quest-complete: true; inventory: sword;\n'.repeat(30000));
  const random = randomBytes(128 * 1024);
  await fs.writeFile(path.join(save, 'a.sav'), text);
  await fs.writeFile(path.join(save, 'b.sav'), text);
  await fs.writeFile(path.join(save, 'encrypted.sav'), random);
  const version = await engine.backup('steam:1', roots);
  assert.equal(version.schema, 2);
  assert.deepEqual(version.compressed, [digest(text)]);
  const data = path.join(engine.directory('steam:1'), version.id, 'data');
  assert.equal((await fs.readdir(data)).length, 2);
  assert.ok((await fs.stat(path.join(data, digest(text)))).size < text.length / 20);
  assert.deepEqual(await fs.readFile(path.join(data, digest(random))), random);
  assert.equal(await engine.backup('steam:1', roots), null);
  await fs.writeFile(path.join(save, 'a.sav'), 'new progress');
  await engine.restore('steam:1', roots, version.id, true);
  assert.deepEqual(await fs.readFile(path.join(save, 'a.sav')), text);
  assert.deepEqual(await fs.readFile(path.join(save, 'b.sav')), text);
  assert.deepEqual(await fs.readFile(path.join(save, 'encrypted.sav')), random);
});

test('reused compressed data survives retention and versions are independent of one another and live saves', async t => {
  const { save, engine, roots } = await fixture(t);
  const content = Buffer.from('unchanged inventory\n'.repeat(30000));
  await fs.writeFile(path.join(save, 'inventory.sav'), content);
  const versions = [];
  for (let i = 0; i < 3; i++) {
    await fs.writeFile(path.join(save, 'slot.sav'), `level ${i}`);
    versions.push(await engine.backup('steam:1', roots));
  }
  assert.deepEqual((await engine.versions('steam:1')).map(v => v.id), [versions[2].id, versions[1].id]);
  const entry = versions[2].files.find(f => f.hash === digest(content));
  const latestFile = blob(engine, versions[2], entry);
  const previousFile = blob(engine, versions[1], entry);
  assert.deepEqual(await fs.readFile(latestFile), await fs.readFile(previousFile));
  await fs.writeFile(previousFile, 'corrupt');
  assert.deepEqual((await engine.versions('steam:1', { fresh: true })).map(v => v.id), [versions[2].id]);
  await fs.writeFile(path.join(save, 'inventory.sav'), 'changed');
  await engine.restore('steam:1', roots, versions[2].id, true);
  assert.deepEqual(await fs.readFile(path.join(save, 'inventory.sav')), content);
  await fs.writeFile(path.join(save, 'inventory.sav'), 'changed again');
  assert.equal((await engine.versions('steam:1', { fresh: true, versionId: versions[2].id })).length, 1);
});

test('legacy raw versions still restore and new versions compress unchanged legacy blobs', async t => {
  const { save, engine, roots } = await fixture(t);
  const content = Buffer.from('legacy save\n'.repeat(50000));
  await fs.writeFile(path.join(save, 'a.sav'), content);
  const first = await engine.backup('steam:1', roots);
  // Reconstruct the previous format exactly: schema 1 with uncompressed blobs.
  const legacy = { ...first, schema: 1 }; delete legacy.compressed; delete legacy.storage;
  await fs.writeFile(blob(engine, first), content);
  const folder = path.dirname(path.dirname(blob(engine, first)));
  const metadata = JSON.stringify(legacy, null, 2);
  await fs.writeFile(path.join(folder, 'manifest.json'), metadata);
  await fs.writeFile(path.join(folder, 'COMPLETE'), digest(metadata));
  assert.equal((await engine.versions('steam:1', { fresh: true }))[0].schema, 1);
  await fs.writeFile(path.join(save, 'b.sav'), 'next slot');
  const next = await engine.backup('steam:1', roots);
  assert.ok(next.compressed.includes(digest(content)));
  await engine.restore('steam:1', roots, legacy.id, true);
  assert.deepEqual(await fs.readFile(path.join(save, 'a.sav')), content);
  await assert.rejects(fs.access(path.join(save, 'b.sav')), { code: 'ENOENT' });
});

test('corrupt, oversized decompression and invalid compression metadata are never restorable', async t => {
  const { save, engine, roots } = await fixture(t);
  await fs.writeFile(path.join(save, 'a.sav'), 'save data'.repeat(10000));
  const version = await engine.backup('steam:1', roots);
  const file = blob(engine, version);
  const original = await fs.readFile(file);
  await fs.writeFile(file, gzipSync(Buffer.alloc(version.files[0].bytes + 1)));
  assert.equal((await engine.versions('steam:1', { fresh: true })).length, 0);
  await fs.writeFile(file, original.subarray(0, original.length - 5));
  assert.equal((await engine.versions('steam:1', { fresh: true })).length, 0);
  await fs.writeFile(file, original);
  const folder = path.dirname(path.dirname(file));
  const invalid = JSON.stringify({ ...version, compressed: ['../escape'] });
  await fs.writeFile(path.join(folder, 'manifest.json'), invalid);
  await fs.writeFile(path.join(folder, 'COMPLETE'), digest(invalid));
  assert.equal((await engine.versions('steam:1', { fresh: true })).length, 0);
  await assert.rejects(engine.restore('steam:1', roots, version.id, true), /belum lengkap/);
});

test('save changes after the stability check abort compression without publishing or pruning', async t => {
  const { save, engine, roots } = await fixture(t);
  const file = path.join(save, 'a.sav');
  await fs.writeFile(file, 'first stable save'.repeat(10000));
  const first = await engine.backup('steam:1', roots);
  await fs.writeFile(file, 'second stable save'.repeat(10000));
  let changed = false;
  engine.onProgress = (_, phase, completed) => {
    if (phase === 'copying' && completed === 0) changed = true;
  };
  const source = engine.source.bind(engine);
  engine.source = (configured, entry) => {
    if (changed) {
      changed = false;
      // A synchronous mutation makes this test independent of disk timing.
      writeFileSync(file, 'third save during copy'.repeat(10000));
    }
    return source(configured, entry);
  };
  await assert.rejects(engine.backup('steam:1', roots), error => error.code === 'SAVE_UNSTABLE');
  assert.deepEqual((await engine.versions('steam:1')).map(v => v.id), [first.id]);
  assert.ok(!(await fs.readdir(engine.directory('steam:1'))).some(name => name.startsWith('_pending-')));
});

test('compressed local backups export compatible hpb, import idempotently, and restore after a fresh download', async t => {
  const { save, engine, roots } = await fixture(t);
  const content = Buffer.from('cloud save\n'.repeat(50000));
  await fs.writeFile(path.join(save, 'a.sav'), content);
  const version = await engine.backup('steam:1', roots);
  const bytes = await packVersion(engine, 'steam:1', version.id);
  const bundle = JSON.parse(gunzipSync(bytes));
  assert.equal(bundle.manifest.schema, 1);
  assert.equal(bundle.manifest.compressed, undefined);
  assert.deepEqual(Buffer.from(bundle.blobs[digest(content)], 'base64'), content);
  assert.equal(await importVersion(engine, 'steam:1', roots, bytes), version.id);
  await fs.rm(path.join(engine.directory('steam:1'), version.id), { recursive: true });
  await importVersion(engine, 'steam:1', roots, bytes);
  await fs.writeFile(path.join(save, 'a.sav'), 'newer local');
  await engine.restore('steam:1', roots, version.id, true);
  assert.deepEqual(await fs.readFile(path.join(save, 'a.sav')), content);
});
