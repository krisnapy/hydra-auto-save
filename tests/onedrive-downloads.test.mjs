import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { OneDrive } from '../module/onedrive.mjs';
import { digest } from '../module/engine.mjs';
const GRAPH = 'https://graph.microsoft.com/';
const name = `${digest('steam:292030')}_${randomUUID()}_version-1_${digest('package')}.hpb`;
const modern = 'https://my.microsoftpersonalcontent.com/personal/test/_layouts/15/download.aspx?tempauth=PRIVATE-SIGNATURE';
function fixture(address, download, size = 7) {
  const calls = [];
  const provider = new OneDrive({
    loadTokens: async () => ({ access: 'PRIVATE-TOKEN', expiresAt: Date.now() + 999999 }), saveTokens: async () => {},
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (url.startsWith(GRAPH)) {
        assert.equal(options.headers.Authorization, 'Bearer PRIVATE-TOKEN');
        return Response.json({ name, size, '@microsoft.graph.downloadUrl': address });
      }
      assert.equal(options.headers, undefined);
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'manual');
      return download(url, options);
    },
  });
  return { provider, calls };
}

test('modern personal-content and existing storage URLs download without bearer tokens or cookies', async () => {
  for (const url of [modern, 'https://test.files.1drv.com/download', 'https://test.storage.live.com/download', 'https://tenant.sharepoint.com/download']) {
    const f = fixture(url, async address => { assert.equal(address, url); return new Response('package'); });
    assert.equal((await f.provider.download(name)).toString(), 'package');
    assert.equal(f.calls.length, 2);
  }
});

test('signed redirects validate each hop, support relative locations and never inherit Graph authorization', async () => {
  const seen = [];
  const f = fixture(modern, async url => {
    seen.push(url);
    if (seen.length === 1) return new Response(null, { status: 302, headers: { location: '/next?sig=PRIVATE-SECOND' } });
    if (seen.length === 2) return new Response(null, { status: 307, headers: { location: 'https://test.files.1drv.com/final?sig=PRIVATE-THIRD' } });
    return new Response('package');
  });
  assert.equal((await f.provider.download(name)).toString(), 'package');
  assert.equal(seen.length, 3);
  assert.equal(new URL(seen[1]).pathname, '/next');
});

test('initial download URLs reject lookalikes, local hosts, credentials, ports and non-HTTPS before network use', async () => {
  for (const url of [
    'https://my.microsoftpersonalcontent.com.evil.example/a?sig=PRIVATE',
    'https://evilmicrosoftpersonalcontent.com/a?sig=PRIVATE',
    'https://untrusted.microsoftpersonalcontent.com/a?sig=PRIVATE',
    'https://1drv.com.evil.example/a?sig=PRIVATE',
    'https://evilsharepoint.com/a?sig=PRIVATE',
    'http://my.microsoftpersonalcontent.com/a?sig=PRIVATE',
    'https://user:PRIVATE@my.microsoftpersonalcontent.com/a',
    'https://my.microsoftpersonalcontent.com:8443/a?sig=PRIVATE',
    'https://my.microsoftpersonalcontent.com/a#PRIVATE',
    'https://127.0.0.1/a?sig=PRIVATE', 'https://[::1]/a?sig=PRIVATE',
    'https://localhost/a?sig=PRIVATE', 'file:///PRIVATE', 'not a URL PRIVATE',
    'https://my.microsoftpersonalcontent.com\\@evil.example/PRIVATE',
  ]) {
    const f = fixture(url, async () => assert.fail('untrusted address fetched'));
    await assert.rejects(f.provider.download(name), error => /Alamat unduhan/.test(error.message) && !/PRIVATE|https:|tempauth/.test(error.message));
    assert.equal(f.calls.length, 1);
  }
});

test('untrusted and missing redirect destinations stop before another request without exposing signatures', async () => {
  for (const location of ['https://evil.example/download?sig=PRIVATE', 'http://my.microsoftpersonalcontent.com/a?sig=PRIVATE', '//127.0.0.1/PRIVATE', null]) {
    const f = fixture(modern, async () => new Response(null, { status: 302, headers: location ? { location } : {} }));
    await assert.rejects(f.provider.download(name), error => /Alamat unduhan/.test(error.message) && !/PRIVATE|tempauth|https:/.test(error.message));
    assert.equal(f.calls.length, 2);
  }
});

test('signed redirect loops and chains are bounded', async () => {
  const loop = fixture(modern, async () => new Response(null, { status: 302, headers: { location: modern } }));
  await assert.rejects(loop.provider.download(name), /berulang/);
  assert.equal(loop.calls.length, 2);
  let step = 0;
  const chain = fixture(modern, async () => new Response(null, { status: 302, headers: { location: `/hop-${++step}?sig=PRIVATE` } }));
  await assert.rejects(chain.provider.download(name), /Terlalu banyak pengalihan/);
  assert.equal(step, 4, 'at most three redirects and four requests');
});

test('modern download responses still enforce metadata length and reject truncated, excessive and failed content', async () => {
  for (const body of ['short', 'package-excess']) {
    const f = fixture(modern, async () => new Response(body));
    await assert.rejects(f.provider.download(name), /belum lengkap|melampaui batas/);
  }
  const f = fixture(modern, async () => new Response('PRIVATE-ERROR', { status: 403 }));
  await assert.rejects(f.provider.download(name), error => /Unduhan OneDrive gagal/.test(error.message) && !error.message.includes('PRIVATE'));
});

test('manual Graph content redirect supports the modern domain without forwarding authorization', async () => {
  let signed = 0;
  const provider = new OneDrive({ loadTokens: async () => ({ access: 'PRIVATE-TOKEN', expiresAt: Date.now() + 999999 }), saveTokens: async () => {}, fetcher: async (url, options) => {
    if (url.startsWith(GRAPH)) {
      assert.equal(options.headers.Authorization, 'Bearer PRIVATE-TOKEN');
      if (url.endsWith(':/content')) {
        assert.equal(options.redirect, 'manual');
        return new Response(null, { status: 302, headers: { location: modern } });
      }
      return Response.json({ name, size: 7 });
    }
    assert.equal(url, modern); assert.equal(options.headers, undefined); assert.equal(options.credentials, 'omit'); signed++;
    return new Response('package');
  } });
  assert.equal((await provider.download(name)).toString(), 'package'); assert.equal(signed, 1);
});
