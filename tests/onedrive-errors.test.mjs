import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OneDrive } from '../module/onedrive.mjs';
const GRAPH = 'https://graph.microsoft.com/v1.0/';
function provider(fetcher) {
  return new OneDrive({ fetcher, loadTokens: async () => ({ access: 'PRIVATE-TOKEN', expiresAt: Date.now() + 999999 }), saveTokens: async () => {} });
}

test('400 on projected metadata/children retries once without optional query; subsequent 404 remains visible', async () => {
  for (const route of ['me/drive/special/approot:/save.hpd?$select=name,size,@microsoft.graph.downloadUrl', 'me/drive/items/folder/children?$select=id,name,size,eTag,lastModifiedDateTime,folder&$top=200']) {
    const calls = [];
    const p = provider(async (url, options) => {
      calls.push(url); assert.equal(options.headers.Authorization, 'Bearer PRIVATE-TOKEN');
      return url.includes('?') ? Response.json({ error: { code: 'invalidRequest' } }, { status: 400 }) : Response.json({ value: [] });
    });
    assert.equal((await p.graph(route)).status, 200);
    assert.deepEqual(calls, [GRAPH + route, GRAPH + route.split('?')[0]]);
    p.fetcher = async url => Response.json({}, { status: url.includes('?') ? 400 : 404 });
    await assert.rejects(p.graph(route), error => error.status === 404);
  }
});

test('diagnostics expose allowlisted codes and operation without messages, paths, tokens or signed URLs', async () => {
  const p = provider(async () => Response.json({ error: { code: 'invalidRequest', message: 'PRIVATE-PATH PRIVATE-TOKEN https://private/?secret=1', innerError: { code: 'pathTooLong', message: 'PRIVATE-DETAIL', requestId: 'PRIVATE-ID' } } }, { status: 400, headers: { 'retry-after': '12' } }));
  await assert.rejects(p.graph('me/drive/items/PRIVATE-PATH:/save:/content', { method: 'PUT', body: Buffer.from('save') }), error => {
    assert.match(error.message, /400; invalidRequest \/ pathTooLong; mengunggah file/);
    assert.equal(error.retryAfter, 12000);
    assert.equal(error.status, 400);
    assert.doesNotMatch(JSON.stringify({ message: error.message, ...error }), /PRIVATE|https/);
    return true;
  });
});

test('projection compatibility retry never replays writes, pagination, or non-400 failures', async () => {
  for (const [method, status, route] of [
    ['PUT', 400, 'me/drive/items/id:/file:/content?$select=name'],
    ['POST', 400, 'me/drive/items/id/children?$select=name'],
    ['DELETE', 400, 'me/drive/items/id?$select=name'],
    ['GET', 400, 'me/drive/items/id/children?$select=name&$skiptoken=PRIVATE'],
    ['GET', 403, 'me/drive/items/id?$select=name'],
    ['GET', 429, 'me/drive/items/id?$select=name'],
  ]) {
    let calls = 0;
    const p = provider(async () => { calls++; return Response.json({ error: { code: 'PRIVATE-CODE', innerError: { code: 'badArgument' } } }, { status }); });
    await assert.rejects(p.graph(route, { method }), error => error.status === status && !error.message.includes('PRIVATE') && error.message.includes('badArgument'));
    assert.equal(calls, 1);
  }
});

test('malformed/oversized error bodies remain safe and fallback failure does not loop', async () => {
  for (const body of ['not json PRIVATE', 'PRIVATE'.repeat(5000), JSON.stringify({ error: { code: 'PRIVATE-CODE' } })]) {
    let calls = 0;
    const p = provider(async () => { calls++; return new Response(body, { status: 400 }); });
    await assert.rejects(p.graph('me/drive/items/id?$select=name'), error => error.status === 400 && !error.message.includes('PRIVATE') && error.message.includes('membaca metadata file'));
    assert.equal(calls, 2);
  }
});
