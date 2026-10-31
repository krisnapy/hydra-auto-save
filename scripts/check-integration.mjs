import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';
import { applyHydra } from './apply-hydra.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
// Keep this folder under the project so installed React typings can resolve.
await fs.mkdir(path.join(project, '.verification'), { recursive: true });
const root = await fs.mkdtemp(path.join(project, '.verification/check-'));
try {
  await fs.cp(path.join(project, 'tests/fixtures/hydra-4.3.0'), root, { recursive: true });
  await applyHydra(root);
  let count = 0;
  const check = async directory => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await check(file);
      else if (/\.(ts|tsx)$/.test(file)) {
        const result = ts.transpileModule(await fs.readFile(file, 'utf8'), { fileName: file, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
        const errors = result.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error) ?? [];
        if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, { getCurrentDirectory: () => project, getNewLine: () => '\n', getCanonicalFileName: file => file }));
        count++;
      }
    }
  };
  await check(path.join(root, 'src'));
  const component = path.join(root, 'src/renderer/src/components/personal-cloud-backup.tsx');
  execFileSync(process.execPath, [path.join(project, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--jsx', 'react-jsx', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--target', 'ES2022', '--esModuleInterop', '--skipLibCheck', component], { stdio: 'inherit', cwd: project });
  // Resolve and bundle all core modules; unavailable upstream/Electron imports stay external.
  await build({ entryPoints: [path.join(root, 'src/main/services/personal-cloud-backup/index.ts')], outfile: path.join(root, 'main-check.mjs'), bundle: true, platform: 'node', format: 'esm', plugins: [{ name: 'upstream-boundary', setup(plugin) {
    plugin.onResolve({ filter: /.*/ }, args => {
      if (args.kind === 'entry-point' || args.path.startsWith('./core/') || args.path.endsWith('.mjs')) return undefined;
      return { path: args.path, external: true };
    });
  } }] });
  console.log(`Lulus: sintaks ${count} file TypeScript Hydra/integrasi, pemeriksaan tipe komponen React, dan bundle modul utama.`);
  console.log('Batas: belum menjalankan pemeriksaan tipe seluruh Hydra, build installer Windows, atau pengujian Electron di Windows.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
