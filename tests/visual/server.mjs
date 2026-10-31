import { build } from 'esbuild';
import * as sass from 'sass';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const output = path.join(root, '.verification/game-ui-site');
await fs.mkdir(output, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('./entry.tsx', import.meta.url))],
  outfile: path.join(output, 'bundle.js'), bundle: true, platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'actual-component-scss', setup(plugin) {
    plugin.onLoad({ filter: /\.scss$/ }, async args => ({ contents: (await sass.compileAsync(args.path)).css, loader: 'css', resolveDir: path.dirname(args.path) }));
  } }],
});
await fs.writeFile(path.join(output, 'index.html'), '<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Uji panel halaman game</title><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script></html>');
const allowed = new Map([['/', ['index.html', 'text/html']], ['/bundle.js', ['bundle.js', 'text/javascript']], ['/bundle.css', ['bundle.css', 'text/css']]]);
http.createServer(async (request, response) => {
  const target = allowed.get(new URL(request.url, 'http://127.0.0.1').pathname);
  if (!target) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': target[1], 'Cache-Control': 'no-store' });
  response.end(await fs.readFile(path.join(output, target[0])));
}).listen(4178, '127.0.0.1', () => console.log('Visual fixture ready: http://127.0.0.1:4178'));
