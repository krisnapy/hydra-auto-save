import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { BackupController } from '../module/controller.mjs';
import { BackupEngine, makeRoots, digest } from '../module/engine.mjs';
import { ProfileRecovery } from '../module/profile-recovery.mjs';
import { packVersion, splitSharedBundle, sharedObjectName, unpackBundle } from '../module/cloud-bundle.mjs';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-profile-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const oldSave = path.join(dir, 'old-user', 'save');
  await fs.mkdir(oldSave, { recursive: true });
  await fs.writeFile(path.join(oldSave, 'slot.sav'), 'old progress');
  const roots = await makeRoots([{ path: oldSave }]);
  const destination = path.join(dir, 'surviving-drive');
  const oldState = path.join(dir, 'old-state');
  const old = new BackupEngine({ destination, deviceId: randomUUID(), stateDirectory: oldState, stableMs: 1, assertStopped: async () => {} });
  const manifest = await old.backup('steam:1', roots);
  // Actual missing profile/settings and missing source saves, as after reinstall.
  await fs.rm(oldState, { recursive: true, force: true });
  await fs.rm(path.dirname(oldSave), { recursive: true });
  const c = await new BackupController({ stateDirectory: path.join(dir, 'new-state'), stableMs: 1, getGames: async () => [{ id: 'steam:1', title: 'Game Test' }, { id: 'custom:new-id', title: 'New Custom Game' }], assertStopped: async () => {} }).init();
  t.after(() => c.stop());
  await c.configure({ destination: path.join(dir, 'new-backups') });
  const recovery = new ProfileRecovery(c, 'steam:1');
  const listing = await recovery.listLocal(destination);
  assert.equal(listing.sources.length, 1);
  const token = listing.sources[0].token;
  const target = path.join(dir, 'new-user', 'saves');
  const select = async () => {
    const selected = await recovery.select(token);
    const s = selected.selection;
    await recovery.map(s.token, s.roots[0].id, target);
    return s.token;
  };
  const publish = async key => recovery.import(key, JSON.stringify(await recovery.targets(key)));
  return { dir, old, manifest, c, recovery, token, target, select, publish, destination };
}

test('lost profile restores to new identity and missing save path; original backup stays byte-identical', async t => {
  const f = await fixture(t);
  assert.notEqual(f.c.state.deviceId, f.old.deviceId);
  const folder = path.join(f.old.directory('steam:1'), f.manifest.id);
  const before = await fs.readFile(path.join(folder, 'manifest.json'));
  const key = await f.select();
  const imported = await f.publish(key);
  await assert.rejects(fs.stat(f.target), { code: 'ENOENT' }, 'import does not write live save');
  const result = await f.c.restore(imported.gameId, imported.versionId, true);
  assert.equal(await fs.readFile(path.join(f.target, 'slot.sav'), 'utf8'), 'old progress');
  assert.deepEqual(await fs.readFile(path.join(folder, 'manifest.json')), before);
  const history = await f.c.engine.versions('steam:1');
  assert.ok(history.find(v => v.id === result.safety)?.safety);
  assert.equal(history.find(v => v.id === imported.versionId).origin.deviceId, f.old.deviceId);
});

test('settings list old profiles first, show unmatched games only in details, and preserve saves of other current games', async t => {
  const f = await fixture(t);
  const legacySave = path.join(f.dir, 'legacy-custom.sav');
  const newSave = path.join(f.dir, 'new-custom.sav');
  await fs.writeFile(legacySave, 'old-only progress');
  await fs.writeFile(newSave, 'new-only progress');
  await f.old.backup('custom:old-id', await makeRoots([{ path: legacySave }]));
  await f.c.manual('custom:new-id', [{ path: newSave }]);
  await f.c.configure({ destination: f.destination });
  await f.c.backup('custom:new-id');

  const recovery = new ProfileRecovery(f.c);
  const listing = await recovery.listLocal(f.destination);
  assert.equal(listing.profiles.length, 1);
  assert.equal(listing.profiles[0].gameCount, 2);
  assert.deepEqual(listing.sources, []);
  assert.deepEqual((await f.recovery.listLocal(f.destination)).sources.map(source => source.gameId), ['steam:1']);
  const details = recovery.details(listing.profiles[0].token);
  const unmatched = details.sources.find(source => source.gameId === 'custom:old-id');
  const matched = details.sources.find(source => source.gameId === 'steam:1');
  assert.equal(unmatched.restorable, false);
  await assert.rejects(recovery.select(unmatched.token), /Game yang sama/);
  recovery.details();
  await assert.rejects(recovery.select(matched.token), /Pilih sumber/);
  recovery.details(listing.profiles[0].token);

  const selected = (await recovery.select(matched.token)).selection;
  const rootId = selected.roots[0].id;
  await recovery.map(selected.token, rootId, f.dir);
  await assert.rejects(recovery.targets(selected.token), /terpisah/);
  const shared = path.join(f.dir, 'shared');
  await fs.mkdir(shared);
  const nestedSave = path.join(shared, 'other-game.sav');
  await fs.writeFile(nestedSave, 'other-game progress');
  await f.c.manual('custom:new-id', [{ path: newSave }, { path: nestedSave }]);
  await recovery.map(selected.token, rootId, shared);
  await assert.rejects(recovery.targets(selected.token), /save game lain/);
  await recovery.map(selected.token, rootId, f.target);
  await fs.mkdir(f.target, { recursive: true });
  await fs.writeFile(path.join(f.target, 'slot.sav'), 'same slot on new profile');
  await fs.writeFile(path.join(f.target, 'extra-slot.sav'), 'new slot');
  const before = await f.c.engine.versions('custom:new-id', { fresh: true });
  await recovery.import(selected.token, JSON.stringify(await recovery.targets(selected.token)), false, { restore: true });
  assert.equal(await fs.readFile(path.join(f.target, 'slot.sav'), 'utf8'), 'old progress');
  assert.equal(await fs.readFile(path.join(f.target, 'extra-slot.sav'), 'utf8'), 'new slot');
  assert.equal(await fs.readFile(newSave, 'utf8'), 'new-only progress');
  assert.equal(await fs.readFile(nestedSave, 'utf8'), 'other-game progress');
  assert.deepEqual(await f.c.engine.versions('custom:new-id', { fresh: true }), before);
});

test('missing mapping, forged token, changed configuration and changed confirmed targets cannot publish', async t => {
  const f = await fixture(t);
  await assert.rejects(f.recovery.select('forged'), /Pilih sumber/);
  const selected = (await f.recovery.select(f.token)).selection;
  await assert.rejects(f.recovery.targets(selected.token), /setiap lokasi/);
  await f.recovery.map(selected.token, selected.roots[0].id, f.target);
  const confirmed = JSON.stringify(await f.recovery.targets(selected.token));
  await f.recovery.map(selected.token, selected.roots[0].id, path.join(f.dir, 'other-target'));
  await assert.rejects(f.recovery.import(selected.token, confirmed), /Tujuan berubah/);
  await f.c.configure({ retention: 9 });
  await assert.rejects(f.recovery.targets(selected.token), /Pengaturan berubah/);
  assert.deepEqual(await f.c.engine.versions('steam:1'), []);
});

test('targets reject source backup overlap, module data, drive root, symlinks and wrong file kind', async t => {
  const f = await fixture(t);
  const key = await f.select();
  const root = f.recovery.snapshot().selection.roots[0];
  for (const target of [path.parse(f.dir).root, f.c.stateDirectory, f.destination, path.join(f.destination, 'HydraPersonalBackup', 'anything')]) {
    await f.recovery.map(key, root.id, target);
    await assert.rejects(f.recovery.targets(key), /drive|bertumpuk|terpisah/);
  }
  const file = path.join(f.dir, 'file.sav'); await fs.writeFile(file, 'x');
  await f.recovery.map(key, root.id, file);
  await assert.rejects(f.recovery.targets(key), /Jenis lokasi/);
  const link = path.join(f.dir, 'link'); await fs.symlink(f.destination, link);
  await assert.rejects(f.recovery.map(key, root.id, link), /Tautan/);
});

test('source mutations and corrupt blobs fail before local publication', async t => {
  const f = await fixture(t), key = await f.select();
  const folder = path.join(f.old.directory('steam:1'), f.manifest.id);
  const hash = f.manifest.files[0].hash;
  await fs.writeFile(path.join(folder, 'data', hash), 'corrupt');
  await assert.rejects(f.publish(key), /rusak|tidak tersedia|tidak lengkap/);
  assert.deepEqual(await f.c.engine.versions('steam:1'), []);
  await assert.rejects(fs.stat(f.target), { code: 'ENOENT' });
});

for (const shared of [false, true]) test(`OneDrive old profile recovery validates ${shared ? 'shared blobs' : 'legacy package'} and account`, async t => {
  const f = await fixture(t);
  const bytes = await packVersion(f.old, 'steam:1', f.manifest.id);
  const value = await unpackBundle(bytes);
  // packVersion requires source roots metadata only, old profile is absent.
  const packed = shared ? await packVersion(f.old, 'steam:1', f.manifest.id, { shared: true }) : bytes;
  const bundle = shared ? splitSharedBundle(packed) : null;
  const index = bundle ? bundle.index : packed;
  const name = `${digest('steam:1')}_${f.old.deviceId}_${f.manifest.id}_${digest(index)}.hpb`;
  const remote = new Map([[name, index]]);
  const unrelated = `${digest('steam:2')}_${f.old.deviceId}_${f.manifest.id}_${digest(index)}.hpb`;
  if (bundle) for (const object of bundle.value.objects) remote.set(sharedObjectName(bundle.value.manifest, object), bundle.objects.get(object.storedHash));
  let account = 'drive-A';
  const cloud = { connected: true, stopped: false, state: { driveId: 'drive-A' }, provider: {
    identity: async () => account,
    listProfiles: async hash => {
      assert.equal(hash, digest('steam:1'));
      return [{ name: unrelated }, { name, title: 'Game Test', lastModifiedDateTime: value.manifest.createdAt }];
    },
    download: async name => { assert.notEqual(name, unrelated); return remote.get(name); },
  } };
  const list = await f.recovery.listCloud(cloud);
  const selected = (await f.recovery.select(list.sources[0].token)).selection;
  await f.recovery.map(selected.token, selected.roots[0].id, f.target);
  account = 'drive-B';
  await assert.rejects(f.publish(selected.token), /Akun OneDrive berubah/);
  account = 'drive-A';
  const imported = await f.publish(selected.token);
  await f.c.restore(imported.gameId, imported.versionId, true);
  assert.equal(await fs.readFile(path.join(f.target, 'slot.sav'), 'utf8'), 'old progress');
});

test('foreign traversal and fingerprint corruption are rejected before remapping', async t => {
  const f = await fixture(t);
  const value = await unpackBundle(await packVersion(f.old, 'steam:1', f.manifest.id));
  for (const mutation of [v => { v.manifest.fingerprint = '0'.repeat(64); }, v => { v.manifest.files[0].relative = '../escape'; v.manifest.fingerprint = digest(JSON.stringify({ roots: v.manifest.roots, files: v.manifest.files })); }]) {
    const v = structuredClone(value); mutation(v);
    const bytes = gzipSync(Buffer.from(JSON.stringify(v)));
    const name = `${digest('steam:1')}_${f.old.deviceId}_${f.manifest.id}_${digest(bytes)}.hpb`;
    const cloud = { connected: true, stopped: false, state: { driveId: 'A' }, provider: { identity: async () => 'A', listProfiles: async () => [{ name, title: 'bad' }], download: async () => bytes } };
    const list = await f.recovery.listCloud(cloud);
    await assert.rejects(f.recovery.select(list.sources[0].token, 'steam:1'), /rusak|Path/);
  }
});

test('multiple roots require explicit mapping and support missing individual file target', async t => {
  const f = await fixture(t);
  const file = path.join(f.dir, 'old-single.sav'); await fs.writeFile(file, 'single');
  const directory = path.join(f.dir, 'old-folder'); await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'slot'), 'folder');
  const roots = await makeRoots([{ path: file }, { path: directory }]);
  const m = await f.old.backup('steam:1', roots);
  const listing = await f.recovery.listLocal(f.destination);
  const source = listing.sources.find(s => s.createdAt === m.createdAt);
  const s = (await f.recovery.select(source.token)).selection;
  for (const root of s.roots) await f.recovery.map(s.token, root.id, root.kind === 'file' ? path.join(f.dir, 'new-single.sav') : f.target);
  const imported = await f.publish(s.token);
  await f.c.restore(imported.gameId, imported.versionId, true);
  assert.equal(await fs.readFile(path.join(f.dir, 'new-single.sav'), 'utf8'), 'single');
  assert.equal(await fs.readFile(path.join(f.target, 'slot'), 'utf8'), 'folder');
});

test('local recovery streams saves larger than OneDrive limit without bundling them in memory', async t => {
  const f = await fixture(t);
  const large = path.join(f.dir, 'large.sav');
  const size = 128 * 1024 ** 2 + 1;
  const file = await fs.open(large, 'w'); await file.truncate(size); await file.close();
  const roots = await makeRoots([{ path: large }]);
  const m = await f.old.backup('steam:1', roots);
  const list = await f.recovery.listLocal(f.destination);
  const selected = (await f.recovery.select(list.sources.find(s => s.createdAt === m.createdAt).token)).selection;
  const target = path.join(f.dir, 'restored-large.sav');
  await f.recovery.map(selected.token, selected.roots[0].id, target);
  const imported = await f.publish(selected.token);
  await f.c.restore(imported.gameId, imported.versionId, true);
  assert.equal((await fs.stat(target)).size, size);
  assert.equal((await f.c.engine.versions(imported.gameId)).find(v => v.id === imported.versionId).files[0].hash, m.files[0].hash);
});

test('running game blocks restore, keeps import available for retry, and leaves current save untouched', async t => {
  const f = await fixture(t), key = await f.select();
  await fs.mkdir(f.target, { recursive: true }); await fs.writeFile(path.join(f.target, 'slot.sav'), 'current');
  const confirmed = JSON.stringify(await f.recovery.targets(key));
  f.c.engine.assertStopped = async () => { throw new Error('Game masih berjalan.'); };
  await assert.rejects(f.recovery.import(key, confirmed, false, { restore: true }), /masih berjalan/);
  assert.equal(await fs.readFile(path.join(f.target, 'slot.sav'), 'utf8'), 'current');
  const imported = (await f.c.engine.versions('steam:1')).find(v => v.reason === 'profile-recovery');
  assert.ok(imported);
  f.c.engine.assertStopped = async () => {};
  await f.c.restore('steam:1', imported.id, true);
  assert.equal(await fs.readFile(path.join(f.target, 'slot.sav'), 'utf8'), 'old progress');
});

test('interrupted profile restore verifies both restored and preserved saves before clearing the journal', async t => {
  const f = await fixture(t), key = await f.select();
  await fs.mkdir(f.target, { recursive: true });
  const extra = path.join(f.target, 'new-slot.sav');
  await fs.writeFile(extra, 'new save');
  const confirmed = JSON.stringify(await f.recovery.targets(key));
  f.c.engine.onProgress = (_, phase) => {
    if (phase === 'restore-cleanup') throw new Error('interrupted after commit');
  };
  await assert.rejects(f.recovery.import(key, confirmed, false, { restore: true }), /interrupted after commit/);
  assert.equal((await f.c.engine.recovery('steam:1')).committed, true);
  await f.c.recover('steam:1');
  assert.equal(await f.c.engine.recovery('steam:1'), null);
  assert.equal(await fs.readFile(path.join(f.target, 'slot.sav'), 'utf8'), 'old progress');
  assert.equal(await fs.readFile(extra, 'utf8'), 'new save');
});
