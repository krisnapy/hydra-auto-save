import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, safePath } from '../module/engine.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
const metadata = JSON.parse(await fs.readFile(path.join(project, 'integration/upstream.json'), 'utf8'));
const once = (source, anchor, replacement) => {
  if (source.split(anchor).length !== 2) throw new Error(`Anchor integrasi berubah atau tidak unik: ${anchor.slice(0, 70)}`);
  return source.replace(anchor, replacement);
};

export function integrate(files) {
  const result = { ...files };
  const edit = (file, anchor, replacement) => { result[file] = once(result[file], anchor, replacement); };
  const prepend = (file, text) => { result[file] = `${text}\n${result[file]}`; };
  edit('src/main/events/index.ts', 'import "./auth";', 'import "./personal-cloud-backup";\nimport "./auth";');
  prepend('src/main/index.ts', 'import { startPersonalBackup, stopPersonalBackup } from "./services/personal-cloud-backup";');
  edit('src/main/index.ts', '  // Optional integration failures must not interrupt launcher startup.', '  await startPersonalBackup().catch(error => logger.warn("[Personal Backup] Startup failed", error));\n\n  // Optional integration failures must not interrupt launcher startup.');
  edit('src/main/index.ts', '    await saveSocialWindowsSession();', '    await saveSocialWindowsSession();\n    await stopPersonalBackup().catch(error => logger.warn("[Personal Backup] Shutdown failed", error));');
  prepend('src/main/services/process-watcher.ts', 'import { onPersonalBackupGameClosed } from "./personal-cloud-backup";');
  edit('src/main/services/process-watcher.ts', '  if (!options.isShutdown) onScreenshotGameClosed(gameKey);', '  if (!options.isShutdown) onScreenshotGameClosed(gameKey);\n  if (!options.isShutdown) onPersonalBackupGameClosed(game);');
  result['src/preload/index.ts'] += '\ncontextBridge.exposeInMainWorld("personalBackup", {\n  invoke: (request: Record<string, unknown>) => ipcRenderer.invoke("personalBackup", request),\n});\n';
  prepend('src/renderer/src/pages/settings/settings.tsx', 'import { PersonalCloudBackup } from "../../components/personal-cloud-backup";');
  edit('src/renderer/src/pages/settings/settings.tsx', '      {\n        id: "general" as const,', '      { id: "personal_backup" as const, label: "Personal Cloud Backup", icon: <CloudIcon size={16} /> },\n      {\n        id: "general" as const,');
  edit('src/renderer/src/pages/settings/settings.tsx', '          const renderCategory = () => {', '          const renderCategory = () => {\n            if (selectedCategoryId === "personal_backup") return <PersonalCloudBackup />;');
  edit('src/renderer/src/context/settings/settings.context.tsx', 'export type SettingsCategoryId =', 'export type SettingsCategoryId =\n  | "personal_backup"');
  edit('src/renderer/src/context/settings/settings.context.tsx', '  return [\n    "general",', '  return [\n    "personal_backup",\n    "general",');
  prepend('src/renderer/src/pages/game-details/game-details-content.tsx', 'import { PersonalCloudBackup } from "../../components/personal-cloud-backup";');
  edit('src/renderer/src/pages/game-details/game-details-content.tsx', '            <DescriptionHeader />', '            {game?.executablePath && (game.shop === "steam" || game.shop === "custom") && <PersonalCloudBackup key={`${game.shop}:${game.objectId}`} gameId={`${game.shop}:${game.objectId}`} />}\n            <DescriptionHeader />');
  prepend('src/main/helpers/launch-game.ts', 'import { withLaunchGate } from "../services/personal-cloud-backup/core/launch-guard.mjs";');
  edit('src/main/helpers/launch-game.ts', 'export const launchGame = async (options: LaunchGameOptions) => {', 'const launchGameWithoutPersonalBackupGate = async (options: LaunchGameOptions) => {');
  result['src/main/helpers/launch-game.ts'] += '\nexport const launchGame = (options: LaunchGameOptions) => process.platform === "win32" && (options.shop === "steam" || options.shop === "custom") ? withLaunchGate(`${options.shop}:${options.objectId}`, () => launchGameWithoutPersonalBackupGate(options)) : launchGameWithoutPersonalBackupGate(options);\n';
  return result;
}

async function walk(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(file));
    else result.push(file);
  }
  return result;
}

export async function applyHydra(target) {
  const root = await safePath(path.resolve(target));
  const sources = {};
  for (const [file, expected] of Object.entries(metadata.files)) {
    await safePath(path.join(root, file));
    const content = await fs.readFile(path.join(root, file), 'utf8');
    if (digest(content) !== expected.sha256) throw new Error(`File berbeda dari Hydra ${metadata.ref}: ${file}. Tidak ada perubahan yang ditulis.`);
    sources[file] = content;
  }
  const patched = integrate(sources);
  const writes = [];
  const overlay = path.join(project, 'integration/overlay');
  for (const file of await walk(overlay)) writes.push([path.relative(overlay, file), await fs.readFile(file)]);
  for (const file of await walk(path.join(project, 'module'))) writes.push([path.join('src/main/services/personal-cloud-backup/core', path.basename(file)), await fs.readFile(file)]);
  for (const [file] of writes) {
    await safePath(path.join(root, file));
    try { await fs.access(path.join(root, file)); throw new Error(`File tambahan sudah ada: ${file}. Tidak ada perubahan yang ditulis.`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const backup = path.join(root, '.personal-backup-originals');
  try { await fs.access(backup); throw new Error('Folder cadangan integrasi sudah ada. Periksa instalasi sebelumnya.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(backup);
  const written = [];
  try {
    for (const [file, source] of Object.entries(sources)) {
      await fs.mkdir(path.dirname(path.join(backup, file)), { recursive: true });
      await fs.writeFile(path.join(backup, file), source);
    }
    for (const [file, content] of [...Object.entries(patched), ...writes]) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      written.push(file);
      await fs.writeFile(path.join(root, file), content);
    }
  } catch (error) {
    for (const file of written.reverse()) {
      if (file in sources) await fs.writeFile(path.join(root, file), sources[file]);
      else await fs.rm(path.join(root, file), { force: true });
    }
    throw error;
  }
  return { files: written.length, backup };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!target) { console.error('Pemakaian: node scripts/apply-hydra.mjs <folder-source-Hydra-4.3.0>'); process.exitCode = 1; }
  else {
    try { const result = await applyHydra(target); console.log(`Integrasi ditulis ke ${path.resolve(target)} (${result.files} file). Sumber asli: ${result.backup}`); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
