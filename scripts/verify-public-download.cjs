const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// No Authorization header: this verifies the same download available to a signed-out user.
module.exports = async function verifyPublicDownload(asset, { fetch = globalThis.fetch, sleep = delay, attempts = 12, log = () => {} } = {}) {
  let detail;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const url = new URL(asset.browser_download_url);
    if (attempt) url.searchParams.set('download-check', `${asset.id}-${attempt}`);
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(20000) });
      const length = Number(response.headers.get('content-length'));
      detail = `HEAD HTTP ${response.status}, size ${length}/${asset.size}`;
      if (response.ok && length === asset.size) { log(`Anonymous download verified: ${asset.browser_download_url}`); return; }
      // Some proxies/CDNs do not serve HEAD correctly. Check one byte and the total size.
      const range = await fetch(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      const valid = range.status === 206 ? range.headers.get('content-range') === `bytes 0-0/${asset.size}` : range.status === 200 && Number(range.headers.get('content-length')) === asset.size;
      await range.body?.cancel();
      detail += `; GET HTTP ${range.status}`;
      if (valid) { log(`Anonymous download verified by GET: ${asset.browser_download_url}`); return; }
    } catch (error) { detail = error.message; }
    log(`Download check ${attempt + 1}/${attempts}: ${asset.name}: ${detail}`);
    if (attempt + 1 < attempts) await sleep(5000);
  }
  throw new Error(`Anonymous download failed: ${asset.name}: ${detail}`);
};
