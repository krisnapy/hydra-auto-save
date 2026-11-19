import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import ts from 'typescript';
import { BackupController } from '../module/controller.mjs';
import { CloudSync } from '../module/cloud-sync.mjs';
import { ProfileRecovery } from '../module/profile-recovery.mjs';
import { packVersion, splitSharedBundle, sharedObjectName, importVersion } from '../module/cloud-bundle.mjs';
import { digest } from '../module/engine.mjs';
import { hydraIdentity, accountKey, backupAccount, accountMatch } from '../module/backup-account.mjs';

const A = { server: 'https://hydra.test', userId: 'hydra-user-A' };
const B = { server: 'https://hydra.test', userId: 'hydra-user-B' };
const clientId = '11111111-2222-3333-4444-555555555555';
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-account-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const save = path.join(directory, 'save'); await fs.mkdir(save); await fs.writeFile(path.join(save, 'slot'), 'progress');
  const destination = path.join(directory, 'backups');
  const controller = async (name, account, getAccount = () => account) => {
    const c = await new BackupController({ stateDirectory: path.join(directory, name), getAccount, getGames: async () => [{ id: 'steam:1', title: 'Game' }], assertStopped: async () => {}, stableMs: 1 }).init();
    t.after(() => c.stop());
    await c.configure({ destination });
    return c;
  };
  const cloud = async c => {
    let tokens = null;
    const sync = await new CloudSync({ directory: path.join(c.stateDirectory, 'onedrive'), controller: c, vault: { load: async () => tokens, save: async value => { tokens = value; } } }).init();
    sync.connected = true; sync.state.driveId = 'drive-A'; sync.state.accountBinding = backupAccount(c.hydraAccount, 'drive-A');
    t.after(() => sync.stop());
    return sync;
  };
  const version = async c => { await c.manual('steam:1', [{ path: save }]); return c.backup('steam:1'); };
  return { directory, save, destination, controller, cloud, version };
}

test('account identity uses stable Hydra server/user ID and OneDrive drive ID, independent of device or display name', () => {
  assert.deepEqual(hydraIdentity({ ...A, server: A.server + '/', displayName: 'Changed Name' }), A);
  assert.notEqual(accountKey(A), accountKey(B));
  assert.notEqual(accountKey(A), accountKey({ ...A, server: 'https://other.test' }));
  const owner = backupAccount(A, 'drive-A');
  assert.equal(accountMatch(owner, A, 'drive-A'), 'matched');
  assert.equal(accountMatch(owner, B, 'drive-A'), 'different');
  assert.equal(accountMatch(owner, A, 'drive-B'), 'different');
  assert.equal(accountMatch(undefined, A, 'drive-A'), 'legacy');
  assert.throws(() => hydraIdentity({ ...A, server: 'https://user:secret@hydra.test' }), /Server akun/);
});

test('local backups carry Hydra identity, matching survives reinstall, and another account cannot select them', async t => {
  const f = await fixture(t);
  const old = await f.controller('old-profile', A), manifest = await f.version(old);
  assert.deepEqual(manifest.account, backupAccount(A));
  const fresh = await f.controller('fresh-profile', A);
  assert.notEqual(old.state.deviceId, fresh.state.deviceId);
  const recovery = new ProfileRecovery(fresh), list = await recovery.listLocal(f.destination);
  assert.equal(list.sources.length, 1); assert.equal(list.sources[0].ownership, 'matched');
  const selected = (await recovery.select(list.sources[0].token, 'steam:1')).selection;
  const target = path.join(f.directory, 'fresh-save');
  await recovery.map(selected.token, selected.roots[0].id, target);
  const imported = await recovery.import(selected.token, JSON.stringify(await recovery.targets(selected.token)));
  await fresh.restore(imported.gameId, imported.versionId, true);
  assert.equal(await fs.readFile(path.join(target, 'slot'), 'utf8'), 'progress');
  const other = await f.controller('other-profile', B);
  assert.equal((await new ProfileRecovery(other).listLocal(f.destination)).sources.length, 0);
});

test('matching OneDrive backups require both Hydra identity and drive, even across new devices', async t => {
  const f = await fixture(t), old = await f.controller('old', A), m = await f.version(old);
  const remote = new Map();
  for (const [hydra, drive] of [[A, 'drive-A'], [B, 'drive-A'], [A, 'drive-B']]) {
    const packed = splitSharedBundle(await packVersion(old.engine, 'steam:1', m.id, { shared: true, account: backupAccount(hydra, drive) }));
    const name = `${digest('steam:1')}_${old.state.deviceId}_${m.id}_${digest(packed.index)}.hpb`;
    remote.set(name, packed.index);
    for (const object of packed.value.objects) remote.set(sharedObjectName(packed.value.manifest, object), packed.objects.get(object.storedHash));
  }
  const fresh = await f.controller('new', A), sync = await f.cloud(fresh);
  sync.provider = { identity: async () => 'drive-A', listProfiles: async () => [...remote.keys()].filter(name => name.endsWith('.hpb')).map(name => ({ name, title: 'Game' })), download: async name => remote.get(name) };
  const recovery = new ProfileRecovery(fresh), list = await recovery.listCloud(sync);
  assert.equal(list.sources.length, 1); assert.equal(list.sources[0].ownership, 'matched');
  const wrong = await f.controller('wrong', B), wrongSync = await f.cloud(wrong);
  wrongSync.provider = sync.provider;
  assert.equal((await new ProfileRecovery(wrong).listCloud(wrongSync)).sources.length, 1, 'B sees only B ownership, despite same OneDrive');
  const selected = (await recovery.select(list.sources[0].token, 'steam:1')).selection;
  const target = path.join(f.directory, 'restored-cloud');
  await recovery.map(selected.token, selected.roots[0].id, target);
  const imported = await recovery.import(selected.token, JSON.stringify(await recovery.targets(selected.token)));
  await fresh.restore(imported.gameId, imported.versionId, true);
  assert.equal(await fs.readFile(path.join(target, 'slot'), 'utf8'), 'progress');
  assert.deepEqual((await fresh.engine.versions('steam:1')).find(v => v.id === imported.versionId).origin.account, backupAccount(A, 'drive-A'));
});

test('legacy backups need explicit claim; claim copies ownership without changing source', async t => {
  const f = await fixture(t), old = await f.controller('old', A), m = await f.version(old);
  const folder = path.join(old.engine.directory('steam:1'), m.id);
  const original = JSON.parse(await fs.readFile(path.join(folder, 'manifest.json'), 'utf8')); delete original.account;
  const bytes = JSON.stringify(original, null, 2); await fs.writeFile(path.join(folder, 'manifest.json'), bytes); await fs.writeFile(path.join(folder, 'COMPLETE'), digest(bytes));
  const fresh = await f.controller('new', A), recovery = new ProfileRecovery(fresh);
  const list = await recovery.listLocal(f.destination); assert.equal(list.sources[0].ownership, 'legacy');
  const s = (await recovery.select(list.sources[0].token, 'steam:1')).selection;
  await recovery.map(s.token, s.roots[0].id, path.join(f.directory, 'target'));
  const confirmed = JSON.stringify(await recovery.targets(s.token));
  await assert.rejects(recovery.import(s.token, confirmed), /Konfirmasi penautan/);
  const imported = await recovery.import(s.token, confirmed, true);
  const result = (await fresh.engine.versions('steam:1')).find(v => v.id === imported.versionId);
  assert.deepEqual(result.account, backupAccount(A)); assert.equal(result.origin.claimedLegacy, true);
  assert.equal(await fs.readFile(path.join(folder, 'manifest.json'), 'utf8'), bytes);
});

test('Hydra logout/account switch invalidates source selections, controller operations and cloud queues', async t => {
  const f = await fixture(t); let current = A;
  const c = await f.controller('profile', A, () => current), m = await f.version(c), sync = await f.cloud(c);
  await sync.enqueue(c.engine, 'steam:1', m.id);
  const job = sync.state.jobs[0]; assert.ok(job.accountKey);
  const recovery = new ProfileRecovery(c), list = await recovery.listLocal(f.destination);
  current = B;
  await assert.rejects(c.backup('steam:1'), /Profil Hydra berubah/);
  await assert.rejects(recovery.select(list.sources[0].token, 'steam:1'), /Profil Hydra berubah/);
  await assert.rejects(sync.run(), /Profil Hydra berubah/);
  current = null;
  await assert.rejects(sync.begin(clientId), /Profil Hydra berubah/);
  assert.equal(sync.state.jobs[0].uploadedAt, undefined);
});

test('OneDrive linking needs Hydra login and persistent pair; old unowned jobs are held', async t => {
  const f = await fixture(t), guest = await f.controller('guest', null), guestCloud = await f.cloud(guest);
  await assert.rejects(guestCloud.begin(clientId), /Login Hydra/);
  const c = await f.controller('A', A), m = await f.version(c), sync = await f.cloud(c);
  sync.state.accountBinding = backupAccount(B, 'drive-A');
  await assert.rejects(sync.enqueue(c.engine, 'steam:1', m.id), /Pasangan akun/);
  sync.state.accountBinding = backupAccount(A, 'drive-A');
  await sync.enqueue(c.engine, 'steam:1', m.id);
  delete sync.state.jobs[0].accountKey;
  assert.equal(sync.snapshot().pending, 0); assert.equal(sync.snapshot().held, 1);
  let uploads = 0; sync.provider = { upload: async () => { uploads++; } };
  await sync.run(); assert.equal(uploads, 0);
});

test('cloud login records current Hydra/OneDrive pair and queued index carries that ownership', async t => {
  const f = await fixture(t), c = await f.controller('A', A), m = await f.version(c), sync = await f.cloud(c);
  sync.connected = false; sync.state.driveId = ''; delete sync.state.accountBinding;
  sync.provider = { beginLogin: async () => ({ code: 'private', interval: 5000, expiresAt: Date.now() + 60000 }), completeLogin: async () => {}, identity: async () => 'drive-A' };
  await sync.begin(clientId); sync.nextLoginAt = 0; await sync.run();
  assert.deepEqual(sync.state.accountBinding, backupAccount(A, 'drive-A'));
  await sync.enqueue(c.engine, 'steam:1', m.id);
  const packed = splitSharedBundle(await fs.readFile(sync.packageFile(sync.state.jobs[0])));
  assert.deepEqual(packed.value.manifest.account, backupAccount(A, 'drive-A'));
  assert.deepEqual((await c.engine.versions('steam:1'))[0].account, backupAccount(A), 'upload does not rewrite local owner');
});

test('service account routing isolates profiles and credentials and drains old service on account changes', async () => {
  let context = { userId: A.userId }, listener;
  const controllers = [], stoppedClouds = [];
  class Controller {
    constructor(options) { this.options = options; this.stateDirectory = options.stateDirectory; this.stopped = false; controllers.push(this); }
    async init() { return this; }
    async snapshot() { this.options.assertSession(); return { ludusavi: 'bundled' }; }
    async stop() { this.stopped = true; }
    start() { this.started = true; }
  }
  const source = (await fs.readFile(new URL('../integration/overlay/src/main/services/personal-cloud-backup/index.ts', import.meta.url), 'utf8')).replaceAll('import.meta.env.MAIN_VITE_API_URL', JSON.stringify(A.server));
  const modules = {
    electron: { app: { getPath: () => '/profile-data' }, BrowserWindow: { getAllWindows: () => [] } },
    'node:path': path, 'node:fs': {}, '@main/level': {}, '../native-addon': {}, '../game-running-state': {}, '../logger': { logger: { warn() {} } }, '../launched-game-pids': {}, './core/profile-recovery.mjs': {}, './core/controller.mjs': { BackupController: Controller }, './core/launch-guard.mjs': {}, '../epic/cloud-saves': {},
    '../hydra-api': { HydraApi: { getAuthContext: () => context, onAuthContextChanged: fn => { listener = fn; } } },
    './core/backup-account.mjs': { accountKey, hydraIdentity },
    './onedrive': { getOneDrive: async () => {}, stopOneDrive: async c => { stoppedClouds.push(c); } },
  };
  const exported = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { exports: exported, require: name => { assert.ok(modules[name], name); return modules[name]; }, process: { platform: 'win32' } });
  const one = await exported.getPersonalBackup();
  assert.match(one.stateDirectory, new RegExp(accountKey(A)));
  context = { userId: B.userId }; listener();
  const two = await exported.getPersonalBackup();
  assert.notEqual(one.stateDirectory, two.stateDirectory); assert.equal(one.stopped, true); assert.ok(stoppedClouds.includes(one));
  assert.throws(() => one.options.assertSession(), /Sesi Hydra berubah/);
  context = null; listener(); const guest = await exported.getPersonalBackup();
  assert.equal(guest.stateDirectory, path.join('/profile-data', 'personal-cloud-backup'));
  context = { userId: A.userId }; listener(); const back = await exported.getPersonalBackup();
  assert.equal(back.stateDirectory, one.stateDirectory); assert.equal(two.stopped, true);
});


test('account changes at live replacement boundary abort before overwriting current save', async t => {
  const f = await fixture(t); let current = A;
  const c = await f.controller('A', A, () => current), m = await f.version(c);
  await fs.writeFile(path.join(f.save, 'slot'), 'current save');
  let checks = 0;
  c.engine.assertStopped = async () => { if (++checks === 2) current = B; };
  await assert.rejects(c.restore('steam:1', m.id, true), /Profil Hydra berubah/);
  assert.equal(await fs.readFile(path.join(f.save, 'slot'), 'utf8'), 'current save');
  current = A;
});


test('direct cloud import cannot silently relabel a foreign Hydra owner', async t => {
  const f = await fixture(t), old = await f.controller('A', A), m = await f.version(old);
  const other = await f.controller('B', B); await other.manual('steam:1', [{ path: f.save }]);
  const bytes = await packVersion(old.engine, 'steam:1', m.id, { account: backupAccount(B, 'drive-A') });
  // The source device/root still match old.engine; owner must independently match.
  await assert.rejects(importVersion(old.engine, 'steam:1', old.state.games['steam:1'].roots, bytes), /Pemilik backup/);
});
