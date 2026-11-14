import { BUNDLE_LIMIT } from './cloud-bundle.mjs';
import { digest } from './engine.mjs';
// Public application identifier; never embed a client secret in desktop builds.
export const DEFAULT_CLIENT_ID = process.env.HYDRA_ONEDRIVE_CLIENT_ID || ''; 
const AUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/';
const GRAPH = 'https://graph.microsoft.com/v1.0/';
const SCOPE = 'https://graph.microsoft.com/Files.ReadWrite.AppFolder offline_access';
export const validClientId = id => typeof id === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id);
export const cloudName = name => typeof name === 'string' && /^[a-f0-9]{64}_[a-f0-9-]{36}_[a-zA-Z0-9-]{1,100}_[a-f0-9]{64}\.hpb$/.test(name);
export const objectName = name => typeof name === 'string' && /^[a-f0-9]{64}_[a-f0-9-]{36}_blob_[a-f0-9]{64}\.hpd$/.test(name);
const storageName = name => cloudName(name) || objectName(name);
const ROOT = 'me/drive/special/approot';
const scopePrefix = name => name.slice(0, 102);
const folderLabel = (value, fallback) => {
  // OneDrive/Windows reserved names, trailing punctuation and UTF-16 length.
  const text = String(value || fallback).normalize('NFC').replace(/[\x00-\x1f\x7f"*:<>?\\/|#%]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '');
  return ([...text].slice(0, 70).join('') || fallback).replace(/[. ]+$/g, '');
};
const itemBase = item => {
  if (typeof item?.id !== 'string' || !item.id || item.id.length > 512) throw new Error('Identitas folder OneDrive tidak valid.');
  return `me/drive/items/${encodeURIComponent(item.id)}`;
};

export class OneDrive {
  constructor({ clientId, loadTokens, saveTokens, fetcher = fetch, resolveScope }) {
    Object.assign(this, { clientId, loadTokens, saveTokens, fetcher, resolveScope });
    this.resetFolders();
  }
  resetFolders() { this.folders = new Map(); this.locations = new Map(); }
  scope(prefix) {
    const value = this.resolveScope?.(prefix);
    if (!value) return null;
    if (typeof value.gameId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.deviceId) || `${digest(value.gameId)}_${value.deviceId}_` !== prefix) throw new Error('Identitas folder game tidak valid.');
    return { ...value, gameSuffix: ` [${digest(value.gameId).slice(0, 12)}]`, deviceSuffix: ` [${value.deviceId}]` };
  }
  async children(base) {
    const collection = `${base}/children`;
    let relative = `${collection}?$select=id,name,size,eTag,lastModifiedDateTime,folder&$top=200`;
    const result = [];
    for (let page = 0; relative && page < 100; page++) {
      const data = await (await this.graph(relative)).json();
      if (!Array.isArray(data.value)) throw new Error('Daftar OneDrive tidak valid.');
      result.push(...data.value);
      const next = data['@odata.nextLink'];
      if (next && (typeof next !== 'string' || !next.startsWith(GRAPH + collection + '?'))) throw new Error('Alamat lanjutan OneDrive tidak valid.');
      relative = next ? next.slice(GRAPH.length) : '';
    }
    if (relative) throw new Error('Terlalu banyak versi cloud. Periksa folder aplikasi OneDrive.');
    return result;
  }
  async childFolder(base, suffix, label, create, entries) {
    const find = items => {
      const matches = items.filter(item => typeof item.name === 'string' && item.name.endsWith(suffix));
      if (matches.length > 1 || matches.some(item => !item.folder)) throw new Error('Folder game OneDrive bertentangan atau ganda. Periksa folder aplikasi.');
      if (matches[0]) itemBase(matches[0]);
      return matches[0];
    };
    const found = find(entries ?? await this.children(base));
    if (found || !create) return found;
    const name = folderLabel(label, 'Backup') + suffix;
    let item;
    try {
      item = await (await this.graph(`${base}/children`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) })).json();
    } catch (error) {
      if (error.status !== 409) throw error;
      item = find(await this.children(base));
      if (!item) throw error;
    }
    if (!item?.folder || typeof item.name !== 'string' || !item.name.endsWith(suffix)) throw new Error('Folder OneDrive belum dapat diverifikasi.');
    itemBase(item);
    return item;
  }
  async directory(prefix, create = false, rootEntries) {
    const scope = this.scope(prefix);
    if (!scope) return null;
    if (this.folders.has(prefix)) return this.folders.get(prefix);
    const game = await this.childFolder(ROOT, scope.gameSuffix, scope.gameTitle || scope.gameId, create, rootEntries);
    if (!game) return null;
    const device = await this.childFolder(itemBase(game), scope.deviceSuffix, scope.deviceName || 'PC', create);
    if (!device) return null;
    const base = itemBase(device);
    this.folders.set(prefix, base);
    return base;
  }
  async metadata(name) {
    const folder = await this.directory(scopePrefix(name));
    if (folder) {
      const item = `${folder}:/${name}`;
      try { return { item, metadata: await (await this.graph(`${item}?$select=name,size,@microsoft.graph.downloadUrl`)).json() }; }
      catch (error) { if (error.status !== 404) throw error; }
    }
    const item = `${ROOT}:/${name}`;
    return { item, metadata: await (await this.graph(`${item}?$select=name,size,@microsoft.graph.downloadUrl`)).json() };
  }
  async request(url, { redirect = 'error', ...options } = {}) {
    try { return await this.fetcher(url, { ...options, signal: AbortSignal.timeout(60000), redirect }); }
    catch { throw new Error('OneDrive belum dapat dihubungi. Periksa koneksi; antrean lokal dipertahankan.'); }
  }
  async oauth(endpoint, values) {
    const response = await this.request(AUTH + endpoint, { method: 'POST', body: new URLSearchParams({ client_id: this.clientId, ...values }) });
    const value = await response.json();
    if (!response.ok) {
      const allowed = ['authorization_pending', 'slow_down', 'authorization_declined', 'expired_token', 'invalid_grant'];
      const code = allowed.includes(value.error) ? value.error : 'oauth_error';
      throw Object.assign(new Error(code === 'oauth_error' ? 'Login Microsoft gagal. Periksa client ID dan konfigurasi public client pada pendaftaran aplikasi.' : `Login Microsoft: ${code}.`), { code });
    }
    return value;
  }
  async beginLogin() {
    if (!validClientId(this.clientId)) throw new Error('Masukkan Application (client) ID Microsoft terlebih dahulu.');
    const value = await this.oauth('devicecode', { scope: SCOPE });
    if (typeof value.device_code !== 'string' || typeof value.user_code !== 'string' || !Number.isFinite(value.expires_in) || value.expires_in <= 0 || value.expires_in > 1800) throw new Error('Jawaban login Microsoft tidak valid.');
    const loginUrls = ['https://www.microsoft.com/link', 'https://microsoft.com/link', 'https://www.microsoft.com/devicelogin', 'https://microsoft.com/devicelogin'];
    if (!loginUrls.includes(value.verification_uri)) throw new Error('Alamat login Microsoft tidak dikenali. Mulai login kembali.');
    return { code: value.device_code, userCode: value.user_code, url: value.verification_uri, expiresAt: Date.now() + value.expires_in * 1000, interval: Math.max(5, Math.min(60, Number(value.interval) || 5)) * 1000 };
  }
  async completeLogin(code) {
    const value = await this.oauth('token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: code });
    return this.store(value);
  }
  async store(value, previous = {}) {
    if (typeof value.access_token !== 'string' || !Number.isFinite(value.expires_in)) throw new Error('Token Microsoft tidak valid.');
    const tokens = { access: value.access_token, refresh: value.refresh_token || previous.refresh, expiresAt: Date.now() + value.expires_in * 1000 };
    await this.saveTokens(tokens);
    return tokens;
  }
  async access() {
    this.refreshing ??= (async () => {
      const tokens = await this.loadTokens();
      if (!tokens) throw new Error('Hubungkan kembali akun OneDrive.');
      if (tokens.expiresAt > Date.now() + 60000) return tokens.access;
      if (!tokens.refresh) throw new Error('Sesi Microsoft berakhir. Hubungkan kembali akun.');
      const next = await this.oauth('token', { grant_type: 'refresh_token', refresh_token: tokens.refresh, scope: SCOPE });
      return (await this.store(next, tokens)).access;
    })().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
  async graph(relative, options = {}, expectedStatus) {
    const response = await this.request(GRAPH + relative, { ...options, headers: { ...options.headers, Authorization: `Bearer ${await this.access()}` } });
    if (expectedStatus === undefined ? !response.ok : response.status !== expectedStatus) {
      const delay = Math.min(3600000, Math.max(0, Number(response.headers.get('retry-after')) || 0) * 1000);
      throw Object.assign(new Error(response.status === 401 ? 'Sesi OneDrive berakhir. Hubungkan kembali akun.' : response.status === 507 ? 'Ruang OneDrive tidak cukup. Backup lokal tetap tersedia.' : `OneDrive gagal merespons (${response.status}). Antrean dipertahankan.`), { retryAfter: delay, status: response.status });
    }
    return response;
  }
  async identity() {
    const root = await (await this.graph('me/drive/special/approot')).json();
    const driveId = root.parentReference?.driveId;
    if (typeof driveId !== 'string' || !driveId) throw new Error('Identitas OneDrive belum dapat diverifikasi.');
    if (this.driveId !== driveId) { this.resetFolders(); this.driveId = driveId; }
    return driveId;
  }
  async upload(name, bytes) {
    if (!storageName(name) || bytes.length > BUNDLE_LIMIT) throw new Error('Paket unggahan tidak valid.');
    let base = ROOT;
    if (this.scope(scopePrefix(name))) {
      // Do not create a duplicate when retrying an index already in the flat layout.
      let legacy = false;
      if (cloudName(name)) {
        try { await this.graph(`${ROOT}:/${name}?$select=name`); legacy = true; }
        catch (error) { if (error.status !== 404) throw error; }
      }
      if (!legacy) base = await this.directory(scopePrefix(name), true);
    }
    const item = await (await this.graph(`${base}:/${name}:/content`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })).json();
    if (item.name !== name || item.size !== bytes.length || !item.id) throw new Error('Hasil unggahan OneDrive belum dapat diverifikasi.');
    return item.id;
  }
  async list(prefix, { objects = false } = {}) {
    const rootEntries = await this.children(ROOT);
    const folder = await this.directory(prefix, false, rootEntries);
    const groups = [{ base: ROOT, entries: rootEntries }];
    if (folder) groups.push({ base: folder, entries: await this.children(folder) });
    const result = [], seen = new Set();
    for (const { base, entries } of groups) for (const item of entries) {
      if (!(objects ? storageName(item.name) : cloudName(item.name)) || !item.name.startsWith(prefix)) continue;
      if (seen.has(item.name)) throw new Error('File backup ganda ditemukan pada folder lama dan folder game. Pembersihan dihentikan.');
      seen.add(item.name);
      // Keep malformed scoped entries visible to the retention verifier, so
      // an unreadable index cannot hide references to shared save data.
      result.push(item);
      if (this.locations.size > 40000) this.locations.clear();
      this.locations.set(item.name, { item: `${base}:/${item.name}`, eTag: item.eTag });
    }
    return result;
  }
  async remove(name, eTag) {
    if (!storageName(name) || typeof eTag !== 'string' || !eTag || eTag.length > 1000 || /[\r\n]/.test(eTag)) throw new Error('Identitas versi cloud belum dapat dipastikan. Muat ulang pemeriksaan optimisasi.');
    let item = `${ROOT}:/${name}`;
    if (this.scope(scopePrefix(name))) {
      const location = this.locations.get(name);
      if (!location || location.eTag !== eTag) throw new Error('Muat ulang pemeriksaan optimisasi sebelum menghapus versi.');
      item = location.item;
    }
    const response = await this.graph(item, { method: 'DELETE', headers: { 'If-Match': eTag } });
    if (response.status !== 204) throw new Error('Hasil pembersihan OneDrive belum dapat dipastikan. Periksa ulang daftar versi.');
  }
  async download(name) {
    if (!storageName(name)) throw new Error('Nama versi cloud tidak valid.');
    const { item, metadata } = await this.metadata(name);
    if (metadata.name !== name || !Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > BUNDLE_LIMIT) throw new Error('Ukuran paket cloud tidak valid.');
    let address = metadata['@microsoft.graph.downloadUrl'];
    if (address == null || address === '') {
      // Read the redirect in the main process so Authorization stays on Graph.
      const redirect = await this.graph(`${item}:/content`, { redirect: 'manual' }, 302);
      address = redirect.headers.get('location');
    }
    if (typeof address !== 'string' || !URL.canParse(address)) throw new Error('Alamat unduhan OneDrive tidak valid. Muat ulang daftar versi lalu coba lagi.');
    const url = new URL(address);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname.endsWith('.files.1drv.com') || url.hostname.endsWith('.1drv.com') || url.hostname.endsWith('.sharepoint.com') || url.hostname.endsWith('.storage.live.com'))) throw new Error('Alamat unduhan OneDrive tidak dikenali.');
    const response = await this.request(url.href);
    if (!response.ok) throw new Error('Unduhan OneDrive gagal. Coba muat ulang daftar versi.');
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > BUNDLE_LIMIT || length > metadata.size) { throw new Error('Paket cloud melampaui batas ukuran.'); }
      chunks.push(chunk);
    }
    if (length !== metadata.size) throw new Error('Unduhan cloud belum lengkap.');
    return Buffer.concat(chunks);
  }
}
