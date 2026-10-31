import { BUNDLE_LIMIT } from './cloud-bundle.mjs';
// Public application identifier; never embed a client secret in desktop builds.
export const DEFAULT_CLIENT_ID = process.env.HYDRA_ONEDRIVE_CLIENT_ID || ''; 
const AUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/';
const GRAPH = 'https://graph.microsoft.com/v1.0/';
const SCOPE = 'https://graph.microsoft.com/Files.ReadWrite.AppFolder offline_access';
export const validClientId = id => typeof id === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id);
export const cloudName = name => typeof name === 'string' && /^[a-f0-9]{64}_[a-f0-9-]{36}_[a-zA-Z0-9-]{1,100}_[a-f0-9]{64}\.hpb$/.test(name);

export class OneDrive {
  constructor({ clientId, loadTokens, saveTokens, fetcher = fetch }) { Object.assign(this, { clientId, loadTokens, saveTokens, fetcher }); }
  async request(url, options = {}) {
    try { return await this.fetcher(url, { ...options, signal: AbortSignal.timeout(60000), redirect: 'error' }); }
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
    return { code: value.device_code, userCode: value.user_code, expiresAt: Date.now() + value.expires_in * 1000, interval: Math.max(5, Math.min(60, Number(value.interval) || 5)) * 1000 };
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
  async graph(relative, options = {}) {
    const response = await this.request(GRAPH + relative, { ...options, headers: { ...options.headers, Authorization: `Bearer ${await this.access()}` } });
    if (!response.ok) {
      const delay = Math.min(3600000, Math.max(0, Number(response.headers.get('retry-after')) || 0) * 1000);
      throw Object.assign(new Error(response.status === 401 ? 'Sesi OneDrive berakhir. Hubungkan kembali akun.' : response.status === 507 ? 'Ruang OneDrive tidak cukup. Backup lokal tetap tersedia.' : `OneDrive gagal merespons (${response.status}). Antrean dipertahankan.`), { retryAfter: delay });
    }
    return response;
  }
  async identity() {
    const root = await (await this.graph('me/drive/special/approot')).json();
    const driveId = root.parentReference?.driveId;
    if (typeof driveId !== 'string' || !driveId) throw new Error('Identitas OneDrive belum dapat diverifikasi.');
    return driveId;
  }
  async upload(name, bytes) {
    if (!cloudName(name) || bytes.length > BUNDLE_LIMIT) throw new Error('Paket unggahan tidak valid.');
    const item = await (await this.graph(`me/drive/special/approot:/${name}:/content`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })).json();
    if (item.name !== name || item.size !== bytes.length || !item.id) throw new Error('Hasil unggahan OneDrive belum dapat diverifikasi.');
    return item.id;
  }
  async list(prefix) {
    let relative = 'me/drive/special/approot/children?$select=id,name,size,lastModifiedDateTime&$top=200';
    const result = [];
    for (let page = 0; relative && page < 100; page++) {
      const data = await (await this.graph(relative)).json();
      if (!Array.isArray(data.value)) throw new Error('Daftar OneDrive tidak valid.');
      result.push(...data.value.filter(item => cloudName(item.name) && item.name.startsWith(prefix) && Number.isSafeInteger(item.size) && item.size <= BUNDLE_LIMIT));
      const next = data['@odata.nextLink'];
      if (next && (!next.startsWith(GRAPH + 'me/drive/special/approot/children?'))) throw new Error('Alamat lanjutan OneDrive tidak valid.');
      relative = next ? next.slice(GRAPH.length) : '';
    }
    if (relative) throw new Error('Terlalu banyak versi cloud. Periksa folder aplikasi OneDrive.');
    return result;
  }
  async download(name) {
    if (!cloudName(name)) throw new Error('Nama versi cloud tidak valid.');
    // Graph redirects /content to a signed download URL. Never forward Authorization there.
    const metadata = await (await this.graph(`me/drive/special/approot:/${name}?$select=name,size,@microsoft.graph.downloadUrl`)).json();
    if (metadata.name !== name || !Number.isSafeInteger(metadata.size) || metadata.size > BUNDLE_LIMIT) throw new Error('Ukuran paket cloud tidak valid.');
    const url = new URL(metadata['@microsoft.graph.downloadUrl']);
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
