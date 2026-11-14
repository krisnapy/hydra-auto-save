import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { OneDrive } from '../module/onedrive.mjs';
import { digest } from '../module/engine.mjs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BackupController } from '../module/controller.mjs';
import { CloudSync } from '../module/cloud-sync.mjs';
import { packVersion, splitSharedBundle, sharedObjectName, SAVE_LIMIT } from '../module/cloud-bundle.mjs';
const ROOT = 'me/drive/special/approot';
const device = randomUUID();
const prefix = (gameId = 'steam:1', pc = device) => `${digest(gameId)}_${pc}_`;
const versionName = (gameId, value, pc = device) => `${prefix(gameId, pc)}version-${digest(value).slice(0, 8)}_${digest(value)}.hpb`;

export function graphFixture() {
  const entries = new Map(), calls = [];
  let serial = 0, driveId = 'drive-A', conflict = false;
  const insert = (parent, name, bytes) => {
    const id = `item-${++serial}`;
    const item = { id, parent, name, eTag: `"${serial}"`, lastModifiedDateTime: new Date().toISOString(), ...(bytes === undefined ? { folder: {} } : { size: bytes.length, bytes: Buffer.from(bytes) }) };
    entries.set(id, item); return item;
  };
  const metadata = item => { const { bytes, parent, ...value } = item; return value; };
  const fetcher = async (address, options = {}) => {
    const url = new URL(address); calls.push({ address, method: options.method || 'GET', options });
    if (url.hostname === 'test.files.1drv.com') {
      assert.equal(options.headers, undefined);
      const item = entries.get(url.pathname.slice(1));
      return new Response(item.bytes);
    }
    assert.equal(url.origin, 'https://graph.microsoft.com');
    assert.equal(options.headers.Authorization, 'Bearer TEST-ONLY');
    const relative = url.pathname.slice('/v1.0/'.length);
    let parent, rest;
    if (relative.startsWith(ROOT)) { parent = 'root'; rest = relative.slice(ROOT.length); }
    else {
      const match = /^me\/drive\/items\/([^/:]+)(.*)$/.exec(relative);
      assert.ok(match, relative); parent = decodeURIComponent(match[1]); rest = match[2];
      if (!entries.has(parent)) return Response.json({}, { status: 404 });
    }
    if (!rest) return Response.json({ parentReference: { driveId } });
    if (rest === '/children') {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        assert.equal(body['@microsoft.graph.conflictBehavior'], 'fail');
        if (conflict) { conflict = false; insert(parent, body.name); return Response.json({}, { status: 409 }); }
        if ([...entries.values()].some(item => item.parent === parent && item.name === body.name)) return Response.json({}, { status: 409 });
        return Response.json(metadata(insert(parent, body.name)), { status: 201 });
      }
      return Response.json({ value: [...entries.values()].filter(item => item.parent === parent).map(metadata) });
    }
    assert.ok(rest.startsWith(':/'), rest);
    const content = rest.endsWith(':/content');
    const name = decodeURIComponent(rest.slice(2, content ? -9 : undefined));
    let item = [...entries.values()].find(item => item.parent === parent && item.name === name);
    if (options.method === 'PUT') {
      if (item) entries.delete(item.id);
      item = insert(parent, name, options.body);
      return Response.json(metadata(item));
    }
    if (!item) return Response.json({}, { status: 404 });
    if (options.method === 'DELETE') {
      if (options.headers['If-Match'] !== item.eTag) return Response.json({}, { status: 412 });
      entries.delete(item.id); return new Response(null, { status: 204 });
    }
    return Response.json({ ...metadata(item), '@microsoft.graph.downloadUrl': `https://test.files.1drv.com/${item.id}` });
  };
  const provider = (gameId = 'steam:1', pc = device, title = 'ELDEN RING') => new OneDrive({
    loadTokens: async () => ({ access: 'TEST-ONLY', expiresAt: Date.now() + 1000000 }), saveTokens: async () => {}, fetcher,
    resolveScope: requested => requested === prefix(gameId, pc) ? { gameId, deviceId: pc, gameTitle: title, deviceName: 'PC / Utama' } : null,
  });
  return { entries, calls, insert, fetcher, provider, setDrive: value => { driveId = value; }, conflictOnce: () => { conflict = true; } };
}

test('new uploads use readable game/device folders, find stable IDs after title changes and isolate games/PCs', async () => {
  const f = graphFixture(), provider = f.provider();
  const name = versionName('steam:1', 'save');
  await provider.upload(name, Buffer.from('save'));
  const game = [...f.entries.values()].find(item => item.parent === 'root');
  assert.match(game.name, /^ELDEN RING \[[a-f0-9]{12}\]$/);
  const pc = [...f.entries.values()].find(item => item.parent === game.id);
  assert.equal(pc.name, `PC Utama [${device}]`);
  assert.equal([...f.entries.values()].find(item => item.name === name).parent, pc.id);
  assert.equal((await provider.download(name)).toString(), 'save');
  assert.equal((await f.provider('steam:1', device, 'Changed title').list(prefix())).length, 1);
  await f.provider('steam:2', device, 'ELDEN RING').upload(versionName('steam:2', 'other'), Buffer.from('other'));
  const otherPC = randomUUID();
  await f.provider('steam:1', otherPC).upload(versionName('steam:1', 'pc2', otherPC), Buffer.from('pc2'));
  assert.equal((await provider.list(prefix())).length, 1);
  assert.equal([...f.entries.values()].filter(item => item.parent === 'root').length, 2);
  assert.equal([...f.entries.values()].filter(item => item.parent === game.id && item.folder).length, 2);
});

test('flat backups remain readable/listed and ETag cleanup addresses the listed location only', async () => {
  const f = graphFixture(), provider = f.provider();
  const old = f.insert('root', versionName('steam:1', 'old'), Buffer.from('old'));
  const next = versionName('steam:1', 'new'); await provider.upload(next, Buffer.from('new'));
  assert.equal((await provider.download(old.name)).toString(), 'old');
  const items = await provider.list(prefix()); assert.equal(items.length, 2);
  await provider.remove(old.name, old.eTag);
  assert.equal(f.entries.has(old.id), false);
  const current = items.find(item => item.name === next);
  await provider.remove(next, current.eTag);
  assert.equal((await provider.list(prefix())).length, 0);
  assert.ok([...f.entries.values()].every(item => item.folder));
});

test('retry of an existing flat index does not create another copy or folders', async () => {
  const f = graphFixture(), provider = f.provider();
  const name = versionName('steam:1', 'same'); f.insert('root', name, Buffer.from('same'));
  await provider.upload(name, Buffer.from('same'));
  assert.equal(f.entries.size, 1); assert.equal([...f.entries.values()][0].parent, 'root');
});

test('folder creation conflict reuses the folder and duplicate layouts block cleanup', async () => {
  const f = graphFixture(), provider = f.provider(); f.conflictOnce();
  const name = versionName('steam:1', 'save'); await provider.upload(name, Buffer.from('save'));
  assert.equal([...f.entries.values()].filter(item => item.parent === 'root').length, 1);
  f.insert('root', name, Buffer.from('save'));
  await assert.rejects(provider.list(prefix()), /ganda/);
  await assert.rejects(provider.remove(name, '"unknown"'), /pemeriksaan/);
  assert.equal(f.calls.some(call => call.method === 'DELETE'), false);
});

test('unsafe names, conflicting folder identities and hostile pagination are rejected', async () => {
  const f = graphFixture(), provider = f.provider();
  await assert.rejects(provider.upload('../escape.hpb', Buffer.from('x'))); assert.equal(f.calls.length, 0);
  const suffix = ` [${digest('steam:1').slice(0, 12)}]`;
  f.insert('root', 'First' + suffix); f.insert('root', 'Second' + suffix);
  await assert.rejects(provider.list(prefix()), /ganda/);
  provider.fetcher = async () => Response.json({ value: [], '@odata.nextLink': 'https://evil.example/next' });
  await assert.rejects(provider.list(prefix()), /lanjutan/);
});

test('account changes clear folder and cleanup locations; permission failures never fall back to flat files', async () => {
  const f = graphFixture(), provider = f.provider(); await provider.identity();
  const name = versionName('steam:1', 'save'); await provider.upload(name, Buffer.from('save'));
  await provider.list(prefix()); assert.equal(provider.folders.size, 1);
  f.setDrive('drive-B'); await provider.identity(); assert.equal(provider.folders.size, 0); assert.equal(provider.locations.size, 0);
  provider.fetcher = async address => address.includes('/children') ? f.fetcher(address, { headers: { Authorization: 'Bearer TEST-ONLY' } }) : Response.json({}, { status: 403 });
  const before = f.calls.length; await assert.rejects(provider.download(name), /403/);
  assert.equal(f.calls.slice(before).some(call => call.address.includes(`approot:/${name}`)), false);
});


test('mixed old/new cloud layout preserves shared data through retention and restores after local deletion', async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hydra-folders-'));
  const save = path.join(root, 'save'); await fs.mkdir(save);
  await fs.writeFile(path.join(save, 'common.sav'), 'same-progress-data');
  const slot = path.join(save, 'slot.sav'); await fs.writeFile(slot, 'one');
  const controller = await new BackupController({ stateDirectory: path.join(root, 'state'), stableMs: 1, getGames: async () => [{ id: 'steam:1', title: 'ELDEN RING' }], assertStopped: async () => {} }).init();
  await controller.configure({ destination: path.join(root, 'backups'), retention: 2 });
  await controller.manual('steam:1', [{ path: save }]);
  const f = graphFixture();
  const cloud = await new CloudSync({ directory: path.join(root, 'outbox'), controller, fetcher: f.fetcher, vault: { load: async () => null, save: async () => {} } }).init();
  t.after(async () => { await cloud.stop(); await controller.stop(); await fs.rm(root, { recursive: true, force: true }); });
  cloud.connected = true; cloud.state.driveId = 'drive-A';
  cloud.provider.loadTokens = async () => ({ access: 'TEST-ONLY', expiresAt: Date.now() + 1000000 });
  const first = await controller.backup('steam:1');
  const bundle = splitSharedBundle(await packVersion(controller.engine, 'steam:1', first.id, { shared: true }));
  const scope = `${digest('steam:1')}_${controller.state.deviceId}_`;
  const oldIndex = f.insert('root', `${scope}${first.id}_${digest(bundle.index)}.hpb`, bundle.index);
  for (const object of bundle.value.objects) f.insert('root', sharedObjectName(bundle.value.manifest, object), bundle.objects.get(object.storedHash));
  controller.onBackupCompleted = (engine, id, version) => cloud.backupCompleted(engine, id, version);
  await fs.writeFile(slot, 'two'); const second = await controller.backup('steam:1'); await cloud.tick(); assert.equal(cloud.error, '');
  await fs.writeFile(slot, 'three'); await controller.backup('steam:1'); await cloud.tick(); assert.equal(cloud.error, '');
  const plan = await cloud.planOptimization('steam:1'); assert.equal(plan.remove, 1);
  await cloud.optimize(plan.token, 'steam:1');
  assert.equal(f.entries.has(oldIndex.id), false);
  assert.equal([...f.entries.values()].filter(item => item.parent === 'root' && item.bytes).length, 1, 'unchanged legacy object is still referenced by new versions');
  await fs.rm(controller.engine.directory('steam:1'), { recursive: true, force: true });
  await cloud.list('steam:1'); assert.equal(cloud.snapshot('steam:1').versions.length, 2);
  const remote = cloud.snapshot('steam:1').versions.find(item => item.name.startsWith(scope + second.id + '_'));
  await cloud.download('steam:1', remote.name);
  await controller.restore('steam:1', second.id, true);
  assert.equal(await fs.readFile(slot, 'utf8'), 'two');
  assert.equal(await fs.readFile(path.join(save, 'common.sav'), 'utf8'), 'same-progress-data');
});

test('upload limit diagnostics identify game, actual size and count without changing the local backup', async () => {
  const oversized = { files: [{ bytes: SAVE_LIMIT + 1 }], roots: [] };
  const engine = { versions: async () => [oversized] };
  const cloud = new CloudSync({ controller: { state: { games: { 'steam:1': { title: 'ELDEN RING' } } } } });
  cloud.connected = true; cloud.state = { driveId: 'drive-A', jobs: [] };
  await cloud.backupCompleted(engine, 'steam:1', { id: 'version' });
  assert.match(cloud.error, /ELDEN RING \(steam:1\)/);
  assert.match(cloud.error, /128\.00 MiB dengan 1 file/);
  assert.match(cloud.error, /Backup lokal tetap tersedia/);
  const many = { files: Array.from({ length: 10001 }, () => ({ bytes: 0 })), roots: [] };
  await assert.rejects(packVersion({ versions: async () => [many] }, 'steam:1', 'version'), /10\.001 file/);
});
