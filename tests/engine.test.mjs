import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BackupEngine, makeRoots, digest } from '../module/engine.mjs';
import { setTimeout as delay } from 'node:timers/promises';

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-backup-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const save = path.join(directory, 'save');
  await fs.mkdir(save);
  await fs.writeFile(path.join(save, 'progress.sav'), 'level-1');
  const roots = await makeRoots([{ path: save }]);
  const engine = new BackupEngine({ destination: path.join(directory, 'cloud'), deviceId: 'pc-one', stateDirectory: path.join(directory, 'state'), stableMs: 3, assertStopped: async () => {}, ...options });
  return { directory, save, roots, engine, file: path.join(save, 'progress.sav') };
}

test('backup lengkap, deduplikasi isi dan perubahan dengan ukuran sama', async t => {
  const { engine, roots, file } = await fixture(t);
  const first = await engine.backup('steam:1', roots);
  assert.equal((await engine.versions('steam:1')).length, 1);
  assert.equal(await engine.backup('steam:1', roots), null);
  await fs.writeFile(file, 'level-2');
  const second = await engine.backup('steam:1', roots);
  assert.notEqual(first.fingerprint, second.fingerprint);
  assert.equal((await engine.versions('steam:1')).length, 2);
});

test('save berubah selama masa stabil tidak menghasilkan versi', async t => {
  const { engine, roots, file } = await fixture(t, { stableMs: 80 });
  const pending = engine.backup('steam:1', roots);
  await delay(25);
  await fs.writeFile(file, 'still-writing');
  await assert.rejects(pending, /masih berubah/);
  assert.equal((await engine.versions('steam:1')).length, 0);
});

test('perubahan di tengah copy membatalkan versi dan mempertahankan versi lama', async t => {
  const { engine, roots, file } = await fixture(t);
  await engine.backup('steam:1', roots);
  await fs.writeFile(file, 'level-2');
  const scan = engine.scan.bind(engine);
  let count = 0;
  engine.scan = async (...args) => {
    if (++count === 3) await fs.writeFile(file, 'level-3');
    return scan(...args);
  };
  await assert.rejects(engine.backup('steam:1', roots), /selama penyalinan/);
  assert.equal((await engine.versions('steam:1')).length, 1);
});

test('folder pending dan backup cloud yang belum lengkap disembunyikan', async t => {
  const { engine, roots } = await fixture(t);
  const version = await engine.backup('steam:1', roots);
  const folder = path.join(engine.directory('steam:1'), version.id);
  await fs.mkdir(path.join(engine.directory('steam:1'), '_pending-orphan'));
  await fs.rm(path.join(folder, 'data', version.files[0].hash));
  assert.deepEqual(await engine.versions('steam:1'), []);
  await assert.rejects(engine.restore('steam:1', roots, version.id, true), /belum lengkap/);
});

test('file korup dan manifest korup ditolak', async t => {
  const { engine, roots } = await fixture(t);
  const version = await engine.backup('steam:1', roots);
  const folder = path.join(engine.directory('steam:1'), version.id);
  await fs.writeFile(path.join(folder, 'data', version.files[0].hash), 'corrupt');
  assert.deepEqual(await engine.versions('steam:1'), []);
  await fs.writeFile(path.join(folder, 'manifest.json'), '{}');
  assert.deepEqual(await engine.versions('steam:1'), []);
});

test('retensi hanya memangkas versi perangkat sendiri setelah berhasil', async t => {
  const { engine, roots, file } = await fixture(t, { retention: 2 });
  const other = new BackupEngine({ ...engine, deviceId: 'pc-two' });
  await other.backup('steam:1', roots);
  for (const value of ['one', 'two', 'three']) {
    await fs.writeFile(file, value);
    await engine.backup('steam:1', roots);
  }
  assert.equal((await engine.versions('steam:1')).length, 2);
  assert.equal((await other.versions('steam:1')).length, 1);
});

test('pemulihan membuat backup pengaman dan mengganti keseluruhan folder terpilih', async t => {
  const { engine, roots, file, save } = await fixture(t, { retention: 1 });
  const first = await engine.backup('steam:1', roots);
  await fs.writeFile(file, 'newer-progress');
  await fs.writeFile(path.join(save, 'extra.sav'), 'extra');
  const result = await engine.restore('steam:1', roots, first.id, true);
  assert.equal(await fs.readFile(file, 'utf8'), 'level-1');
  await assert.rejects(fs.access(path.join(save, 'extra.sav')));
  const safety = (await engine.versions('steam:1')).find(version => version.id === result.safety);
  assert.equal(safety.safety, true);
  assert.equal(safety.files.length, 2);
  await engine.restore('steam:1', roots, safety.id, true);
  assert.equal(await fs.readFile(file, 'utf8'), 'newer-progress');
  assert.equal(await fs.readFile(path.join(save, 'extra.sav'), 'utf8'), 'extra');
});

test('tanpa konfirmasi dan game berjalan memblokir pemulihan', async t => {
  const { engine, roots, file } = await fixture(t);
  const first = await engine.backup('steam:1', roots);
  await fs.writeFile(file, 'keep-this');
  await assert.rejects(engine.restore('steam:1', roots, first.id, false), /konfirmasi/);
  engine.assertStopped = async () => { throw new Error('Game berjalan'); };
  await assert.rejects(engine.restore('steam:1', roots, first.id, true), /Game berjalan/);
  assert.equal(await fs.readFile(file, 'utf8'), 'keep-this');
});

test('gagal backup pengaman tidak menyentuh save saat ini', async t => {
  const { engine, roots, file } = await fixture(t);
  const first = await engine.backup('steam:1', roots);
  await fs.writeFile(file, 'keep-this');
  engine.capture = async () => { throw new Error('Ruang habis'); };
  await assert.rejects(engine.restore('steam:1', roots, first.id, true), /Ruang habis/);
  assert.equal(await fs.readFile(file, 'utf8'), 'keep-this');
});

test('rollback lintas lokasi saat proses game muncul di tengah pemulihan', async t => {
  const { engine, file, save } = await fixture(t);
  const file2 = path.join(save, 'second.sav');
  await fs.writeFile(file2, 'second-old');
  const roots = await makeRoots([{ path: file }, { path: file2 }]);
  const first = await engine.backup('steam:1', roots);
  await fs.writeFile(file, 'first-new');
  await fs.writeFile(file2, 'second-new');
  let checks = 0;
  engine.assertStopped = async () => { if (++checks === 4) throw new Error('Game dibuka dari luar'); };
  await assert.rejects(engine.restore('steam:1', roots, first.id, true), /dibuka dari luar/);
  assert.equal(await fs.readFile(file, 'utf8'), 'first-new');
  assert.equal(await fs.readFile(file2, 'utf8'), 'second-new');
});

test('backup gagal bila cloud tidak dapat ditulis, versi lama tetap ada', async t => {
  const { engine, roots, file } = await fixture(t, { retention: 1 });
  await engine.backup('steam:1', roots);
  const old = engine.directory('steam:1');
  await fs.writeFile(file, 'new');
  const blocked = path.join(engine.destination, 'not-a-directory');
  await fs.writeFile(blocked, 'blocked');
  engine.directory = () => path.join(blocked, 'cannot-write');
  await assert.rejects(engine.backup('steam:1', roots));
  engine.directory = () => old;
  assert.equal((await engine.versions('steam:1')).length, 1);
});

test('lokasi backup bertumpuk dengan save dan symlink ditolak', async t => {
  const { engine, roots, save, directory } = await fixture(t);
  engine.destination = path.join(save, 'backups');
  await assert.rejects(engine.backup('steam:1', roots), /terpisah/);
  await fs.symlink(save, path.join(directory, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(makeRoots([{ path: path.join(directory, 'link') }]), /Tautan/);
});

test('metadata path traversal tidak menulis di luar save', async t => {
  const { engine, roots, directory } = await fixture(t);
  const version = await engine.backup('steam:1', roots);
  version.files[0].relative = '../escape.sav';
  const bytes = JSON.stringify(version);
  const folder = path.join(engine.directory('steam:1'), version.id);
  await fs.writeFile(path.join(folder, 'manifest.json'), bytes);
  await fs.writeFile(path.join(folder, 'COMPLETE'), digest(bytes));
  await assert.rejects(engine.restore('steam:1', roots, version.id, true), /tidak aman/);
  await assert.rejects(fs.access(path.join(directory, 'escape.sav')));
});

test('operasi per game tidak berjalan bersamaan', async t => {
  const { engine, roots } = await fixture(t, { stableMs: 30 });
  const first = engine.backup('steam:1', roots);
  await assert.rejects(engine.backup('steam:1', roots), /masih berjalan/);
  await first;
});

test('pemulihan diblokir setelah terdeteksi journal pemulihan terputus', async t => {
  const { engine, roots } = await fixture(t);
  const version = await engine.backup('steam:1', roots);
  await fs.mkdir(engine.stateDirectory, { recursive: true });
  await fs.writeFile(path.join(engine.stateDirectory, `${digest('steam:1')}-restore.json`), '{}');
  await assert.rejects(engine.restore('steam:1', roots, version.id, true), /sebelumnya terputus/);
});

test('slot save baru dapat dihapus saat kembali ke versi sebelum slot dibuat', async t => {
  const { engine, save, file } = await fixture(t);
  const original = await makeRoots([{ path: file }]);
  const version = await engine.backup('steam:1', original);
  const slot2 = path.join(save, 'slot2.sav');
  await fs.writeFile(slot2, 'second-slot');
  const expanded = await makeRoots([{ path: file }, { path: slot2 }]);
  await engine.restore('steam:1', expanded, version.id, true);
  await assert.rejects(fs.access(slot2));
  assert.equal(await fs.readFile(file, 'utf8'), 'level-1');
});

test('slot yang hilang dicatat dan dapat dipulihkan', async t => {
  const { engine, save, file } = await fixture(t);
  const slot2 = path.join(save, 'slot2.sav');
  await fs.writeFile(slot2, 'old-second-slot');
  const roots = await makeRoots([{ path: file }, { path: slot2 }]);
  await engine.backup('steam:1', roots);
  await fs.rm(slot2);
  const deleted = await engine.backup('steam:1', roots);
  await fs.writeFile(slot2, 'created-again');
  await engine.restore('steam:1', roots, deleted.id, true);
  await assert.rejects(fs.access(slot2));
});

test('path Windows dengan trailing space atau nama perangkat ditolak', async t => {
  const { engine, roots } = await fixture(t);
  for (const relative of ['.. /outside.sav', 'CON/progress.sav', 'valid/name.']) {
    assert.throws(() => engine.source(roots, { rootId: roots[0].id, relative, hash: 'a'.repeat(64) }), /tidak aman/);
  }
});

test('tahap dan jumlah file dilaporkan untuk backup, backup pengaman, dan pemulihan', async t => {
  const events = [];
  const { engine, roots, file } = await fixture(t, { onProgress: (gameId, phase, completed, total) => events.push({ gameId, phase, completed, total }) });
  const version = await engine.backup('steam:1', roots);
  assert.ok(events.some(event => event.phase === 'scanning'));
  assert.ok(events.some(event => event.phase === 'copying' && event.completed === 1 && event.total === 1));
  assert.ok(events.some(event => event.phase === 'verifying'));
  await fs.writeFile(file, 'changed');
  events.length = 0;
  await engine.restore('steam:1', roots, version.id, true);
  assert.ok(events.some(event => event.phase === 'checking-restore'));
  assert.ok(events.some(event => event.phase === 'safety-copying' && event.completed === 1));
  assert.ok(events.some(event => event.phase === 'restore-staging' && event.completed === 1 && event.total === 1));
  assert.ok(events.some(event => event.phase === 'restore-replacing' && event.completed === 1 && event.total === 1));
  assert.equal(events.at(-1).phase, 'restore-cleanup');
  assert.equal(await fs.readFile(file, 'utf8'), 'level-1');
});

test('history cache avoids rereading unchanged blobs, coalesces snapshots, and fresh checks bypass it', async t => {
  const { engine, roots, file } = await fixture(t);
  await fs.writeFile(file, Buffer.alloc(8 * 1024 * 1024, 17));
  await engine.backup('steam:cache', roots);
  engine.historyCache.clear();
  const before = { ...engine.historyCacheStats };
  const results = await Promise.all([engine.versions('steam:cache'), engine.versions('steam:cache')]);
  assert.equal(results[0].length, 1);
  assert.equal(results[1].length, 1);
  assert.equal(engine.historyCacheStats.filesHashed - before.filesHashed, 1);
  const coldBytes = engine.historyCacheStats.bytesHashed - before.bytesHashed;
  for (let i = 0; i < 20; i++) assert.equal((await engine.versions('steam:cache')).length, 1);
  assert.equal(engine.historyCacheStats.bytesHashed - before.bytesHashed, coldBytes);
  await engine.versions('steam:cache', { fresh: true });
  assert.equal(engine.historyCacheStats.filesHashed - before.filesHashed, 2);
  console.log(`History cache fixture: ${coldBytes} bytes hashed for initial listing; 0 additional payload bytes hashed across 20 unchanged listings.`);
});

test('history cache notices same-size corruption with restored mtime, missing blobs, and metadata changes', async t => {
  const { engine, roots } = await fixture(t);
  const version = await engine.backup('steam:cache', roots);
  const folder = path.join(engine.directory('steam:cache'), version.id);
  const blob = path.join(folder, 'data', version.files[0].hash);
  const original = await fs.stat(blob);
  await delay(10);
  await fs.writeFile(blob, 'level-X');
  await fs.utimes(blob, original.atime, original.mtime);
  assert.deepEqual(await engine.versions('steam:cache'), []);
  await fs.writeFile(blob, 'level-1');
  assert.equal((await engine.versions('steam:cache')).length, 1);
  await fs.rm(blob);
  assert.deepEqual(await engine.versions('steam:cache'), []);
  await fs.writeFile(blob, 'level-1');
  assert.equal((await engine.versions('steam:cache')).length, 1);
  await fs.writeFile(path.join(folder, 'COMPLETE'), 'invalid');
  assert.deepEqual(await engine.versions('steam:cache'), []);
});

test('restore freshly verifies only the selected version even with a warm history cache', async t => {
  const { engine, roots, file } = await fixture(t);
  const version = await engine.backup('steam:cache', roots);
  await fs.writeFile(file, 'new-progress');
  await engine.backup('steam:cache', roots);
  await engine.versions('steam:cache');
  const calls = [];
  const original = engine.versions.bind(engine);
  engine.versions = async (gameId, options) => {
    const before = engine.historyCacheStats.filesHashed;
    const result = await original(gameId, options);
    calls.push({ options, hashed: engine.historyCacheStats.filesHashed - before });
    return result;
  };
  await engine.restore('steam:cache', roots, version.id, true);
  assert.equal(calls[0].options.fresh, true);
  assert.equal(calls[0].options.versionId, version.id);
  assert.equal(calls[0].hashed, 1);
  assert.equal(await fs.readFile(file, 'utf8'), 'level-1');
});

test('new corrupt backup cannot trigger retention even if older versions are cached', async t => {
  const { engine, roots, file } = await fixture(t, { retention: 1 });
  const old = await engine.backup('steam:cache', roots);
  await fs.writeFile(file, 'next-level');
  const original = engine.versions.bind(engine);
  engine.versions = async (gameId, options) => {
    if (options?.fresh && options.versionId !== old.id) {
      const folder = path.join(engine.directory(gameId), options.versionId);
      const manifest = JSON.parse(await fs.readFile(path.join(folder, 'manifest.json'), 'utf8'));
      await fs.writeFile(path.join(folder, 'data', manifest.files[0].hash), 'broken');
    }
    return original(gameId, options);
  };
  await assert.rejects(engine.backup('steam:cache', roots), /riwayat lama dipertahankan/);
  await fs.access(path.join(engine.directory('steam:cache'), old.id, 'COMPLETE'));
  assert.deepEqual((await original('steam:cache', { fresh: true })).map(v => v.id), [old.id]);
});

async function interruptedFixture(t, committed = false) {
  const value = await fixture(t);
  const { engine, roots, file } = value;
  const target = await engine.backup('steam:recovery', roots);
  await fs.writeFile(file, 'newer-before-restore');
  const safetyFingerprint = digest(JSON.stringify(await engine.scan(roots)));
  const root = roots[0];
  const plan = { ...root, stage: `${root.path}.hydra-restore-11111111-1111-4111-8111-111111111111`, rollback: `${root.path}.hydra-previous-22222222-2222-4222-8222-222222222222`, moved: false, installed: false, present: true, originalPresent: true };
  await fs.rename(root.path, plan.rollback);
  await fs.mkdir(root.path);
  await fs.writeFile(file, 'level-1');
  const journal = engine.journal('steam:recovery');
  await fs.mkdir(engine.stateDirectory, { recursive: true });
  const record = { schema: 2, gameId: 'steam:recovery', committed, safety: 'safety-id', safetyFingerprint, targetFingerprint: target.fingerprint, plans: [plan] };
  await fs.writeFile(journal, JSON.stringify(record));
  return { ...value, plan, journal, record };
}

test('interrupted restore blocks backup and rollback recovers even when rename flags were not persisted', async t => {
  const { engine, roots, file, journal, plan } = await interruptedFixture(t);
  await assert.rejects(engine.backup('steam:recovery', roots), /sebelumnya terputus/);
  await engine.recover('steam:recovery', roots);
  assert.equal(await fs.readFile(file, 'utf8'), 'newer-before-restore');
  await assert.rejects(fs.access(journal));
  await assert.rejects(fs.access(plan.rollback));
  const siblings = await fs.readdir(path.dirname(roots[0].path));
  const preserved = siblings.find(name => name.startsWith('save.hydra-interrupted-'));
  assert.ok(preserved);
  assert.equal(await fs.readFile(path.join(path.dirname(roots[0].path), preserved, 'progress.sav'), 'utf8'), 'level-1');
  await engine.backup('steam:recovery', roots);
});

test('committed interrupted restore keeps restored progress and preserves leftover rollback files', async t => {
  const { engine, roots, file, journal, plan } = await interruptedFixture(t, true);
  await engine.recover('steam:recovery', roots);
  assert.equal(await fs.readFile(file, 'utf8'), 'level-1');
  assert.equal(await fs.readFile(path.join(plan.rollback, 'progress.sav'), 'utf8'), 'newer-before-restore');
  await assert.rejects(fs.access(journal));
});

test('recovery rejects unsafe journals and legacy journals without changing live save', async t => {
  const { engine, roots, file, journal, record, directory } = await interruptedFixture(t);
  record.plans[0].rollback = path.join(directory, 'outside');
  await fs.writeFile(journal, JSON.stringify(record));
  await assert.rejects(engine.recover('steam:recovery', roots), /tidak aman/);
  assert.equal(await fs.readFile(file, 'utf8'), 'level-1');
  await fs.writeFile(journal, '{}');
  await assert.rejects(engine.recover('steam:recovery', roots), /manual/);
  assert.equal((await engine.recovery('steam:recovery')).automatic, false);
});

test('recovery interruption can be retried after live content was preserved but rollback not yet moved', async t => {
  const { engine, roots, journal, record, file } = await interruptedFixture(t);
  record.plans[0].preserved = `${roots[0].path}.hydra-interrupted-33333333-3333-4333-8333-333333333333`;
  await fs.writeFile(journal, JSON.stringify(record));
  await fs.rename(roots[0].path, record.plans[0].preserved);
  await engine.recover('steam:recovery', roots);
  assert.equal(await fs.readFile(file, 'utf8'), 'newer-before-restore');
  assert.equal(await fs.readFile(path.join(record.plans[0].preserved, 'progress.sav'), 'utf8'), 'level-1');
});

test('low space prevents backup before retention and exposes a storage warning', async t => {
  const { engine, roots, file } = await fixture(t, { retention: 1 });
  const old = await engine.backup('steam:space', roots);
  await fs.writeFile(file, 'newer-save');
  engine.availableSpace = async () => ({ availableBytes: 1024, totalBytes: 100000 });
  assert.equal((await engine.storage()).warning, true);
  await assert.rejects(engine.backup('steam:space', roots), /Ruang penyimpanan tidak cukup/);
  assert.equal((await engine.versions('steam:space'))[0].id, old.id);
  assert.equal(await fs.readFile(file, 'utf8'), 'newer-save');
});

test('unverifiable committed recovery keeps its journal and live files for manual handling', async t => {
  const { engine, roots, file, journal, plan } = await interruptedFixture(t, true);
  await fs.writeFile(file, 'unrecognized later progress');
  await assert.rejects(engine.recover('steam:recovery', roots), /belum sesuai/);
  await fs.access(journal);
  await fs.access(plan.rollback);
  assert.equal(await fs.readFile(file, 'utf8'), 'unrecognized later progress');
});

test('recovery refuses to change saves when game status cannot be confirmed stopped', async t => {
  const { engine, roots, file, journal } = await interruptedFixture(t);
  engine.assertStopped = async () => { throw new Error('Game masih berjalan'); };
  await assert.rejects(engine.recover('steam:recovery', roots), /masih berjalan/);
  await fs.access(journal);
  assert.equal(await fs.readFile(file, 'utf8'), 'level-1');
});
