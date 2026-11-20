import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { BackupController } from '../module/controller.mjs';
import { BackupEngine, makeRoots, digest } from '../module/engine.mjs';
import { ProfileRecovery, assertWindowsProfileTarget } from '../module/profile-recovery.mjs';
import { ProfileRestoreQueue } from '../module/profile-restore-queue.mjs';
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
  await fs.mkdir(target, { recursive: true });
  const select = async () => {
    const selected = await recovery.select(token);
    const s = selected.selection;
    await recovery.map(s.token, s.roots[0].id, target);
    return s.token;
  };
  const publish = async key => recovery.import(key, JSON.stringify(await recovery.targets(key)));
  return { dir, old, manifest, c, recovery, token, target, select, publish, destination };
}

test('lost profile restores to new identity and initialized save folder; original backup stays byte-identical', async t => {
  const f = await fixture(t);
  assert.notEqual(f.c.state.deviceId, f.old.deviceId);
  const folder = path.join(f.old.directory('steam:1'), f.manifest.id);
  const before = await fs.readFile(path.join(folder, 'manifest.json'));
  const key = await f.select();
  const imported = await f.publish(key);
  assert.deepEqual(await fs.readdir(f.target), [], 'import does not write live save');
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
  const otherTarget = path.join(f.dir, 'other-target');
  await fs.mkdir(otherTarget);
  await f.recovery.map(selected.token, selected.roots[0].id, otherTarget);
  await assert.rejects(f.recovery.import(selected.token, confirmed), /Tujuan berubah/);
  await f.c.configure({ retention: 9 });
  await assert.rejects(f.recovery.targets(selected.token), /Pengaturan berubah/);
  assert.deepEqual(await f.c.engine.versions('steam:1'), []);
});

test('targets reject source backup overlap, module data, drive root, symlinks and wrong file kind', async t => {
  const f = await fixture(t);
  const key = await f.select();
  const root = f.recovery.snapshot().selection.roots[0];
  await assert.rejects(f.recovery.map(key, root.id, path.parse(f.dir).root), /drive/);
  for (const target of [f.c.stateDirectory, f.destination, f.old.directory('steam:1')]) {
    await f.recovery.map(key, root.id, target);
    await assert.rejects(f.recovery.targets(key), /drive|bertumpuk|terpisah/);
  }
  const file = path.join(f.dir, 'file.sav'); await fs.writeFile(file, 'x');
  await assert.rejects(f.recovery.map(key, root.id, file), /Jenis lokasi/);
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
  assert.deepEqual(await fs.readdir(f.target), []);
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

for (const [fromCloud, count] of [[false, 993], [true, 101]]) test(`restores a profile with ${count} separate save files from ${fromCloud ? 'OneDrive' : 'local backup'}`, async t => {
  const f = await fixture(t);
  const folder = path.join(f.dir, 'game-many-files');
  await fs.mkdir(folder);
  const files = Array.from({ length: count }, (_, i) => path.join(folder, `slot-${i}.sav`));
  for (const file of files) await fs.writeFile(file, 'old slot');
  const roots = await makeRoots(files.map(file => ({ path: file })));
  const version = await f.old.backup('steam:1', roots);
  await f.c.manual('steam:1', files.map(file => ({ path: file })));
  for (const file of files) await fs.writeFile(file, 'new slot');
  const extra = path.join(folder, 'new-only.sav');
  await fs.writeFile(extra, 'new save');

  let listed;
  if (fromCloud) {
    const bytes = await packVersion(f.old, 'steam:1', version.id);
    const name = `${digest(version.gameId)}_${version.deviceId}_${version.id}_${digest(bytes)}.hpb`;
    listed = await f.recovery.listCloud({ connected: true, state: { driveId: 'A' }, provider: {
      identity: async () => 'A', listProfiles: async () => [{ name }], download: async () => bytes,
    } });
  } else {
    listed = await f.recovery.listLocal(f.destination);
  }
  const source = listed.sources.find(item => item.createdAt === version.createdAt);
  const { selection } = await f.recovery.select(source.token);
  assert.equal(selection.roots.length, count);
  assert.ok(selection.roots.every(root => root.files === 1 && root.target));
  const targets = await f.recovery.targets(selection.token);
  await f.recovery.import(selection.token, JSON.stringify(targets), false, { restore: true });
  for (const file of files) assert.equal(await fs.readFile(file, 'utf8'), 'old slot');
  assert.equal(await fs.readFile(extra, 'utf8'), 'new save');
});

test('old profile recovery identifies missing or invalid save locations', async t => {
  const f = await fixture(t);
  const backup = await unpackBundle(await packVersion(f.old, 'steam:1', f.manifest.id));
  for (const [roots, detail] of [
    [[], /tidak mencatat lokasi save/],
    [[null], /Jenis atau ID lokasi save/],
    [Array(10_001).fill(backup.manifest.roots[0]), /10001 lokasi save.*10000 lokasi/],
  ]) {
    const bytes = gzipSync(Buffer.from(JSON.stringify({ ...backup, manifest: { ...backup.manifest, roots } })));
    const name = `${digest('steam:1')}_${f.old.deviceId}_${f.manifest.id}_${digest(bytes)}.hpb`;
    const cloud = { connected: true, state: { driveId: 'A' }, provider: {
      identity: async () => 'A', listProfiles: async () => [{ name }], download: async () => bytes,
    } };
    const listing = await f.recovery.listCloud(cloud);
    await assert.rejects(f.recovery.select(listing.sources[0].token), detail);
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
  const targetFile = path.join(f.dir, 'current-account', 'new-single.sav');
  const fileRoot = s.roots.find(root => root.kind === 'file');
  const folderRoot = s.roots.find(root => root.kind === 'directory');
  await fs.rmdir(f.target);
  await assert.rejects(f.recovery.map(s.token, folderRoot.id, f.target), /Buka game/);
  await assert.rejects(f.recovery.map(s.token, fileRoot.id, targetFile), /Buka game.*buat save/);
  assert.ok(f.recovery.snapshot().selection.roots.every(root => !root.target));
  await fs.mkdir(path.dirname(targetFile));
  await fs.mkdir(f.target);
  await f.recovery.map(s.token, fileRoot.id, targetFile);
  await f.recovery.map(s.token, folderRoot.id, f.target);
  const confirmed = JSON.stringify(await f.recovery.targets(s.token));
  await fs.rmdir(path.dirname(targetFile));
  await assert.rejects(f.recovery.import(s.token, confirmed), /Buka game/);
  await fs.mkdir(path.dirname(targetFile));
  const imported = await f.publish(s.token);
  await f.c.restore(imported.gameId, imported.versionId, true);
  assert.equal(await fs.readFile(targetFile, 'utf8'), 'single');
  assert.equal(await fs.readFile(path.join(f.target, 'slot'), 'utf8'), 'folder');
});

test('Windows restore blocks another user profile but accepts active and shared save locations', () => {
  const home = String.raw`C:\Users\Player`;
  for (const target of [String.raw`C:\Users\Administrator\AppData\EldenRing`, String.raw`D:\Users\Player\Saves`, String.raw`C:\Users\PlayerOld\Saves`, String.raw`C:\Users`, home]) {
    assert.throws(() => assertWindowsProfileTarget(target, home), /profil Windows aktif/);
  }
  for (const target of [String.raw`c:\users\PLAYER\AppData\EldenRing`, String.raw`C:\Users\Public\Documents\Saves`, String.raw`D:\Games\Saves`]) {
    assert.doesNotThrow(() => assertWindowsProfileTarget(target, home));
  }
});

test('old profile restore prefills existing matching roots and leaves stale, ambiguous and other account saves for manual selection', async t => {
  const f = await fixture(t);
  const previous = path.join(f.dir, 'old-profile', 'Game');
  const active = path.join(f.dir, 'active-profile', 'Game');
  const elsewhere = path.join(f.dir, 'second-install', 'Game');
  const exact = path.join(f.dir, 'shared.sav');
  const previousFiles = [exact, ...['GraphicsConfig.xml', 'account/ER0000.sl2', 'account/ER0000.sl2.bak', 'account/stale.sav', 'previous-account/other.sav'].map(name => path.join(previous, name))];
  const activeFiles = [exact, ...['GraphicsConfig.xml', 'account/ER0000.sl2', 'account/ER0000.sl2.bak', 'account/stale.sav', 'new-account/other.sav'].map(name => path.join(active, name)), path.join(elsewhere, 'account/ER0000.sl2.bak')];
  for (const file of new Set([...previousFiles, ...activeFiles])) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'progress');
  }
  const roots = await makeRoots(previousFiles.map(file => ({ path: file })));
  const backup = await f.old.backup('steam:1', roots);
  await fs.writeFile(path.join(f.old.directory('steam:1'), '_INFO GAME.txt'), previousFiles.map(file => `- ${file}`).join('\n'));
  await f.c.manual('steam:1', activeFiles.map(file => ({ path: file })));
  await fs.unlink(path.join(active, 'account/stale.sav'));

  const list = await f.recovery.listLocal(f.destination);
  const { selection } = await f.recovery.select(list.sources.find(source => source.createdAt === backup.createdAt).token);
  assert.deepEqual(new Map(selection.roots.map(root => [root.originalPath, root.target])), new Map([
    [exact, exact],
    [path.join(previous, 'GraphicsConfig.xml'), path.join(active, 'GraphicsConfig.xml')],
    [path.join(previous, 'account/ER0000.sl2'), path.join(active, 'account/ER0000.sl2')],
    [path.join(previous, 'account/ER0000.sl2.bak'), ''],
    [path.join(previous, 'account/stale.sav'), ''],
    [path.join(previous, 'previous-account/other.sav'), ''],
  ]));
  await assert.rejects(f.recovery.targets(selection.token), /setiap lokasi/);
});

test('account folders group a backup into one destination and leave other profiles untouched', async t => {
  const f = await fixture(t);
  const source = path.join(f.dir, 'old', 'Game');
  const game = path.join(f.dir, 'active', 'Game');
  const save = 'ER0000.sl2';
  const extra = `${save}.bak`;
  const shared = 'GraphicsConfig.xml';
  const sourceFiles = [shared, `100/${save}`, `100/${extra}`].map(file => path.join(source, file));
  const first = path.join(game, '200', save);
  const second = path.join(game, '300', save);
  const currentShared = path.join(game, shared);
  for (const file of [...sourceFiles, currentShared, first, second]) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, sourceFiles.includes(file) ? 'old data' : 'current data');
  }
  const backup = await f.old.backup('steam:1', await makeRoots(sourceFiles.map(file => ({ path: file }))));
  await fs.writeFile(path.join(f.old.directory('steam:1'), '_INFO GAME.txt'), sourceFiles.map(file => `- ${file}`).join('\n'));
  const sourceToken = (await f.recovery.listLocal(f.destination)).sources.find(item => item.createdAt === backup.createdAt).token;

  await f.c.manual('steam:1', [currentShared, first].map(file => ({ path: file })));
  const single = (await f.recovery.select(sourceToken)).selection;
  assert.deepEqual(single.targetProfiles.map(profile => profile.name), ['200']);
  assert.ok((await f.recovery.targets(single.token)).some(root => root.path === path.join(path.dirname(first), extra)));

  await f.c.manual('steam:1', [currentShared, first, second].map(file => ({ path: file })));
  const multiple = (await f.recovery.select(sourceToken)).selection;
  assert.deepEqual(multiple.targetProfiles.map(profile => profile.name), ['200', '300']);
  await assert.rejects(f.recovery.targets(multiple.token), /Pilih profil save/);
  assert.throws(() => f.recovery.chooseTargetProfile(multiple.token, 'forged'), /profil tujuan/);
  f.recovery.chooseTargetProfile(multiple.token, multiple.targetProfiles[1].token);
  const targets = await f.recovery.targets(multiple.token);
  assert.ok(targets.some(root => root.path === second));
  assert.ok(targets.every(root => root.path !== first));
  const untouched = await fs.stat(first);
  f.c.engine.onProgress = (_, phase) => {
    if (phase === 'restore-cleanup') throw new Error('interrupted after commit');
  };
  await assert.rejects(f.recovery.import(multiple.token, JSON.stringify(targets), false, { restore: true }), /interrupted after commit/);
  await f.c.recover('steam:1');
  assert.equal(await f.c.engine.recovery('steam:1'), null);
  assert.equal(await fs.readFile(second, 'utf8'), 'old data');
  assert.equal(await fs.readFile(path.join(path.dirname(second), extra), 'utf8'), 'old data');
  assert.equal(await fs.readFile(first, 'utf8'), 'current data');
  assert.equal((await fs.stat(first)).ino, untouched.ino);
  assert.ok(f.c.state.games['steam:1'].roots.some(root => root.path === first));
  const safety = (await f.c.engine.versions('steam:1')).find(version => version.safety && version.scoped);
  f.c.engine.onProgress = () => {};
  await f.c.restore('steam:1', safety.id, true);
  assert.equal(await fs.readFile(second, 'utf8'), 'current data');
  assert.equal((await fs.stat(first)).ino, untouched.ino);
});

for (const scenario of ['single', 'multiple', 'cancel-waiting', 'cancel-staging']) {
  test(`background profile restore: ${scenario}`, async t => {
    const f = await fixture(t);
    const oldFile = path.join(f.dir, 'old', 'Game', '100', 'ER0000.sl2');
    const current = path.join(f.dir, 'current', 'Game');
    const first = path.join(current, '200', 'ER0000.sl2');
    const second = path.join(current, '300', 'ER0000.sl2');
    await fs.mkdir(path.dirname(oldFile), { recursive: true });
    await fs.writeFile(oldFile, 'old progress');
    const oldBackup = await f.old.backup('steam:1', await makeRoots([{ path: oldFile }]));
    await fs.writeFile(path.join(f.old.directory('steam:1'), '_INFO GAME.txt'), `- ${oldFile}`);
    const listing = await f.recovery.listLocal(f.destination);
    const source = listing.sources.find(item => item.createdAt === oldBackup.createdAt);
    const { selection } = await f.recovery.select(source.token);
    assert.ok(selection.roots.every(root => !root.target));
    const paths = scenario === 'multiple' ? [first, second] : [first];
    let running = false;
    let detectionCalls = 0;
    f.c.detect = async gameId => {
      detectionCalls++;
      for (const file of paths) await fs.access(file);
      return f.c.manual(gameId, paths.map(file => ({ path: file })));
    };
    const queue = new ProfileRestoreQueue(f.c, async () => {
      if (running) throw Object.assign(new Error('Game masih berjalan.'), { code: 'GAME_RUNNING' });
    }, (job, controls) => job.recovery.import(job.token, job.confirmedTargets, job.claimLegacy, { ...controls, restore: true }));
    queue.enqueue(f.recovery, selection.token);
    const job = queue.jobs.get('steam:1');
    await job.inFlight;
    assert.equal(queue.snapshot('steam:1')[0].status, 'waiting');
    assert.equal(detectionCalls, 1);
    assert.throws(() => queue.cancel(job.id, 'custom:new-id'), /Antrean/);
    if (scenario === 'cancel-waiting') queue.cancel(job.id);

    running = true;
    for (const file of paths) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, 'fresh progress');
    }
    await queue.gameClosed('custom:new-id');
    assert.equal(await fs.readFile(first, 'utf8'), 'fresh progress');
    assert.equal(detectionCalls, 1);

    let replacementStarted = false;
    f.c.engine.onProgress = (_, phase) => {
      if (scenario === 'cancel-staging' && phase === 'restore-staging') queue.cancel(job.id);
      if (phase === 'restore-replacing') {
        replacementStarted = true;
        assert.equal(queue.snapshot()[0].status, 'finishing');
        assert.throws(() => queue.cancel(job.id), /tidak dapat dibatalkan/);
      }
    };
    running = false;
    await queue.gameClosed('steam:1');
    if (scenario === 'cancel-waiting' || scenario === 'cancel-staging') {
      assert.equal(queue.snapshot()[0].status, 'cancelled');
      assert.equal(replacementStarted, false);
      assert.equal(await fs.readFile(first, 'utf8'), 'fresh progress');
      assert.equal(await f.c.engine.recovery('steam:1'), null);
      assert.deepEqual(await fs.readdir(path.dirname(first)), [path.basename(first)]);
      return;
    }
    if (scenario === 'multiple') {
      const [pending] = queue.snapshot();
      assert.equal(pending.status, 'choose');
      assert.deepEqual(pending.targetProfiles.map(profile => profile.name), ['200', '300']);
      assert.equal(await fs.readFile(second, 'utf8'), 'fresh progress');
      queue.choose(job.id, pending.targetProfiles[1].token);
      await job.inFlight;
      assert.equal(await fs.readFile(second, 'utf8'), 'old progress');
      assert.equal(await fs.readFile(first, 'utf8'), 'fresh progress');
    } else {
      assert.equal(await fs.readFile(first, 'utf8'), 'old progress');
    }
    assert.equal(replacementStarted, true);
    assert.equal(queue.snapshot()[0].status, 'complete');
  });
}

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
