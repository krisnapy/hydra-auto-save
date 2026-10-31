import * as fs from 'node:fs/promises';
import path from 'node:path';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { digest, safePath } from './engine.mjs';

export const SAVE_LIMIT = 32 * 1024 ** 2;
export const BUNDLE_LIMIT = 48 * 1024 ** 2;
const zip = promisify(gzip), unzip = promisify(gunzip);
const invalid = () => new Error('Paket cloud rusak, tidak lengkap, atau tidak sesuai perangkat/lokasi save.');

export async function packVersion(engine, gameId, versionId) {
  const manifest = (await engine.versions(gameId, { fresh: true, versionId }))[0];
  if (!manifest) throw invalid();
  if (manifest.files.length > 10000 || manifest.files.reduce((n, f) => n + f.bytes, 0) > SAVE_LIMIT) throw new Error('Unggahan 0.3 dibatasi 32 MiB dan 10.000 file per versi. Backup lokal tetap tersedia.');
  const blobs = {};
  for (const entry of manifest.files) {
    if (blobs[entry.hash] !== undefined) continue;
    const file = path.join(engine.directory(gameId), versionId, 'data', entry.hash);
    await safePath(file);
    const bytes = await fs.readFile(file);
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.hash) throw invalid();
    blobs[entry.hash] = bytes.toString('base64');
  }
  const encoded = Buffer.from(JSON.stringify({ schema: 1, manifest, blobs }));
  if (encoded.length > BUNDLE_LIMIT) throw new Error('Metadata paket cloud terlalu besar. Backup lokal tetap tersedia.');
  const bytes = await zip(encoded);
  if (bytes.length > BUNDLE_LIMIT) throw invalid();
  return bytes;
}

export async function importVersion(engine, gameId, roots, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > BUNDLE_LIMIT) throw invalid();
  let value;
  try { value = JSON.parse((await unzip(bytes, { maxOutputLength: BUNDLE_LIMIT })).toString('utf8')); }
  catch { throw invalid(); }
  const m = value?.manifest;
  if (value.schema !== 1 || !m || m.schema !== 1 || m.gameId !== gameId || m.deviceId !== engine.deviceId || !/^[a-zA-Z0-9_-]{1,100}$/.test(m.id) || m.id.startsWith('_') || !Array.isArray(m.files) || !Array.isArray(m.roots) || m.files.length > 10000 || typeof m.createdAt !== 'string' || !Number.isFinite(Date.parse(m.createdAt)) || typeof m.safety !== 'boolean' || !Number.isSafeInteger(m.order) || m.order < 0 || typeof value.blobs !== 'object' || value.blobs === null) throw invalid();
  await engine.validate(roots);
  if (m.roots.length !== roots.length || new Set(m.roots.map(r => r.id)).size !== roots.length || m.roots.some(r => !roots.some(local => local.id === r.id && local.kind === r.kind) || typeof r.present !== 'boolean')) throw invalid();
  const targets = new Set(); let size = 0;
  for (const entry of m.files) {
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.hash) || !m.roots.some(r => r.id === entry.rootId && r.present)) throw invalid();
    size += entry.bytes;
    const target = engine.source(roots, entry).toLowerCase();
    if (targets.has(target) || size > SAVE_LIMIT) throw invalid();
    targets.add(target);
    const encoded = value.blobs[entry.hash];
    if (typeof encoded !== 'string' || encoded.length > BUNDLE_LIMIT) throw invalid();
    const blob = Buffer.from(encoded, 'base64');
    if (blob.length !== entry.bytes || digest(blob) !== entry.hash) throw invalid();
  }
  for (const root of m.roots) if (root.present && root.kind === 'file' && m.files.filter(f => f.rootId === root.id).length !== 1) throw invalid();
  if (digest(JSON.stringify({ roots: m.roots, files: m.files })) !== m.fingerprint) throw invalid();
  const directory = engine.directory(gameId);
  await safePath(directory);
  await engine.requireSpace(engine.destination, size);
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, m.id);
  // Never replace an existing local version, even if the remote name matches.
  try {
    await fs.lstat(target);
    const local = (await engine.versions(gameId, { fresh: true, versionId: m.id }))[0];
    if (JSON.stringify(local) !== JSON.stringify(m)) throw invalid();
    return m.id;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stage = path.join(directory, `_cloud-${randomUUID()}`);
  try {
    await fs.mkdir(path.join(stage, 'data'), { recursive: true });
    for (const hash of new Set(m.files.map(f => f.hash))) await fs.writeFile(path.join(stage, 'data', hash), Buffer.from(value.blobs[hash], 'base64'), { flag: 'wx' });
    const metadata = JSON.stringify(m, null, 2);
    await fs.writeFile(path.join(stage, 'manifest.json'), metadata);
    await fs.writeFile(path.join(stage, 'COMPLETE'), digest(metadata));
    await fs.rename(stage, target);
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
  return m.id;
}
