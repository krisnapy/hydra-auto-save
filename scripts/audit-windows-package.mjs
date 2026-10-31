import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(process.argv[2] ?? 'hydra');
const output = path.resolve(process.argv[3] ?? 'package/package-audit.json');
const app = path.join(root, 'dist/win-unpacked');
const files = [];
async function walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile()) files.push({ path: path.relative(app, full).replaceAll('\\', '/'), bytes: (await fs.stat(full)).size });
  }
}
await walk(app);
// Use the archive reader already pinned by electron-builder's dependency tree.
const require = createRequire(path.join(root, 'package.json'));
const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'));
const asar = builderRequire('@electron/asar');
const archive = path.join(app, 'resources/app.asar');
const archiveFiles = [];
for (const item of asar.listPackage(archive)) {
  const relative = item.replace(/^[/\\]/, '').replaceAll('\\', '/');
  // ASAR resolves metadata using the host's path separator. Keep the portable
  // slash form for the report, but pass a native path to the Windows reader.
  const stat = asar.statFile(archive, path.normalize(relative));
  if (typeof stat.size === 'number') archiveFiles.push({ path: relative, bytes: stat.size, unpacked: !!stat.unpacked });
}
function groups(entries) {
  const result = {};
  for (const entry of entries) {
    const group = entry.path.startsWith('node_modules/@') ? entry.path.split('/').slice(0, 3).join('/') : entry.path.split('/').slice(0, entry.path.startsWith('node_modules/') ? 2 : 1).join('/');
    result[group] ??= { files: 0, bytes: 0 };
    result[group].files++;
    result[group].bytes += entry.bytes;
  }
  return Object.entries(result).map(([path, stats]) => ({ path, ...stats })).sort((a, b) => b.bytes - a.bytes);
}
const report = {
  // Archive entries include unpacked records; don't add these bytes to diskBytes.
  diskBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  diskFileCount: files.length,
  largestDiskFiles: files.sort((a, b) => b.bytes - a.bytes).slice(0, 30),
  archiveFileCount: archiveFiles.length,
  archiveGroups: groups(archiveFiles),
  largestArchiveFiles: archiveFiles.sort((a, b) => b.bytes - a.bytes).slice(0, 30),
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Package audit: ${report.diskFileCount} files, ${(report.diskBytes / 1024 ** 2).toFixed(1)} MiB; ${archiveFiles.length} archive entries`);
if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Packaged file audit\n\nDisk size: ${(report.diskBytes / 1024 ** 2).toFixed(1)} MiB. Archive groups (logical sizes, including unpacked entries):\n\n| Group | MiB | Files |\n|---|---:|---:|\n${report.archiveGroups.slice(0, 15).map(group => `| ${group.path} | ${(group.bytes / 1024 ** 2).toFixed(1)} | ${group.files} |`).join('\n')}\n`);
}
