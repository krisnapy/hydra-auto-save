import { test } from 'node:test';
import assert from 'node:assert/strict';
import verify from '../scripts/verify-public-download.cjs';

const asset = { id: 1, name: 'app.exe', size: 123, browser_download_url: 'https://github.com/example/project/releases/download/v1/app.exe' };
test('public download supports HEAD and a proxy which only supports byte range GET', async () => {
  const calls = [];
  await verify(asset, { fetch: async (url, options) => {
    calls.push(options);
    return options.method === 'HEAD' ? new Response(null, { status: 405 }) : new Response(null, { status: 206, headers: { 'content-range': 'bytes 0-0/123' } });
  }, attempts: 1 });
  assert.equal(calls[1].headers.Range, 'bytes=0-0');
  assert.ok(calls.every(call => !call.headers?.Authorization));
});
test('cached missing public download is retried with a fresh URL and mismatched sizes fail', async () => {
  const urls = [];
  await verify(asset, { fetch: async (url, options) => {
    urls.push(String(url));
    return String(url).includes('download-check=') ? new Response(null, { status: 200, headers: { 'content-length': '123' } }) : new Response(null, { status: 404 });
  }, sleep: async () => {}, attempts: 2 });
  assert.ok(urls.at(-1).includes('download-check='));
  await assert.rejects(verify(asset, { fetch: async () => new Response(null, { status: 200, headers: { 'content-length': '122' } }), attempts: 1 }), /size 122\/123/);
});
