import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOneDriveClientId } from './onedrive-build-config.mjs';
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
  // Auth credentials are ready before returning; remote profile refresh must not block the window.
  edit('src/main/services/hydra-api.ts', '    const updatedUserData = await getUserData();\n    if (generation !== this.authContexts.generation) return;\n    this.updateUserSubscription(updatedUserData?.subscription);', '    void getUserData().then(updatedUserData => {\n      if (generation !== this.authContexts.generation) return;\n      this.updateUserSubscription(updatedUserData?.subscription);\n    }).catch(error => logger.warn("[Personal Backup] Background profile refresh unavailable", error));');
  for (const file of ['src/main/index.ts', 'src/main/main.ts']) {
    edit(file, '  initializeEpicIntegration,\n', '');
    prepend(file, 'import { initializeOptionalEpic } from "./services/personal-cloud-backup/optional-startup";');
    edit(file, file.endsWith('/index.ts') ? '  await initializeEpicIntegration().catch((error) => {' : '      await initializeEpicIntegration();', file.endsWith('/index.ts') ? '  void initializeOptionalEpic().catch((error) => {' : '      void initializeOptionalEpic().catch(err => logger.warn("Epic integration initialization failed on startup", err));');
  }
  prepend('src/main/services/window-manager.ts', 'import { getPersonalBackup } from "./personal-cloud-backup";');
  prepend('src/main/services/window-manager.ts', 'import { launchGame } from "../helpers/launch-game";\nimport { dialog } from "electron";');
  edit('src/main/services/window-manager.ts', '        games.map(({ title, executablePath }) => ({', '        games.map(({ title, executablePath, shop, objectId, launchOptions }) => ({');
  edit('src/main/services/window-manager.ts', '            shell.openPath(executablePath);', '            if (shop === "steam" || shop === "custom") {\n              await launchGame({ shop, objectId, executablePath, launchOptions }).catch(error => {\n                logger.warn("Tray game launch failed", error);\n                dialog.showErrorBox("Game belum dapat dibuka", String(error.message ?? error));\n              });\n            } else {\n              await shell.openPath(executablePath);\n            }');
  edit('src/main/services/window-manager.ts', '      const userPreferences = await db.get<string, UserPreferences>(\n        levelKeys.userPreferences,\n        {\n          valueEncoding: "json",\n        }\n      );\n\n      mainWindow.setProgressBar(-1);', '      mainWindow.setProgressBar(-1);');
  edit('src/main/services/window-manager.ts', '      await this.saveScreenConfig(screenConfig);', '      await this.saveScreenConfig(screenConfig);\n      const userPreferences = await db.get<string, UserPreferences>(levelKeys.userPreferences, { valueEncoding: "json" }).catch(() => null);');
  edit('src/main/services/window-manager.ts', 'export class WindowManager {', 'export class WindowManager {\n  private static personalBackupTray: Tray | null = null;\n  private static mainWindowOpening: Promise<void> | undefined;');
  edit('src/main/services/window-manager.ts', '  public static async createMainWindow(options?: CreateMainWindowOptions) {', `  public static createMainWindow(options?: CreateMainWindowOptions) {
    if (this.mainWindow) return Promise.resolve();
    this.mainWindowOpening ??= this.createMainWindowInternal(options).finally(() => { this.mainWindowOpening = undefined; });
    return this.mainWindowOpening;
  }

  private static async createMainWindowInternal(options?: CreateMainWindowOptions) {`);
  edit('src/main/services/window-manager.ts', '  public static async createSystemTray(language: string) {', '  public static async createSystemTray(language: string) {\n    if (this.personalBackupTray && !this.personalBackupTray.isDestroyed()) return;');
  edit('src/main/services/window-manager.ts', '    const updateSystemTray = async () => {', `    this.personalBackupTray = tray;
    const openLauncher = () => this.openMainWindow();
    let cachedMenu = Menu.buildFromTemplate([
      { label: "Buka Hydra Personal Backup", click: openLauncher },
      { label: "Personal Cloud Backup", click: () => this.redirectToMainWindow("settings") },
      { type: "separator" },
      { label: "Keluar", click: () => app.quit() },
    ]);
    let refreshedAt = 0;
    let refreshing: Promise<Menu> | undefined;
    const updateSystemTray = async () => {`);
  edit('src/main/services/window-manager.ts', '      const contextMenu = Menu.buildFromTemplate([', `      const backup = process.platform === "win32" ? await getPersonalBackup().then(controller => controller.snapshot(undefined, true)).catch(() => undefined) : undefined;
      const backupStatus = backup?.operations.length ? "Backup: " + backup.operations.length + " operasi aktif/menunggu" : backup?.enabled ? "Auto Backup aktif" : "Auto Backup nonaktif";
      tray.setToolTip("Hydra Personal Backup · " + backupStatus);
      const contextMenu = Menu.buildFromTemplate([
        { label: backupStatus, enabled: false },
        { label: "Personal Cloud Backup", click: () => this.redirectToMainWindow("settings") },`);
  edit('src/main/services/window-manager.ts', '    const showContextMenu = async () => {\n      const contextMenu = await updateSystemTray();\n      tray.popUpContextMenu(contextMenu);\n    };', `    const refreshMenu = () => {
      if (!refreshing) refreshing = updateSystemTray().then(menu => {
        cachedMenu = menu;
        refreshedAt = Date.now();
        return menu;
      }).catch(error => {
        logger.warn("Tray menu refresh failed", error);
        return cachedMenu;
      }).finally(() => { refreshing = undefined; });
      return refreshing;
    };
    const showContextMenu = () => {
      tray.popUpContextMenu(cachedMenu);
      if (Date.now() - refreshedAt > 15000) void refreshMenu();
    };`);
  edit('src/main/services/window-manager.ts', '      await updateSystemTray();\n\n      tray.addListener("double-click", () => {\n        if (this.mainWindow) {\n          this.mainWindow.show();\n        } else {\n          this.createMainWindow();\n        }\n      });', '      void refreshMenu();\n\n      tray.addListener("double-click", openLauncher);');
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
    if (entry.name === '.DS_Store') continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(file));
    else result.push(file);
  }
  return result;
}

export async function applyHydra(target) {
  const root = await safePath(path.resolve(target));
  const clientId = await readOneDriveClientId();
  const sources = {};
  const originals = {};
  for (const [file, expected] of Object.entries(metadata.files)) {
    await safePath(path.join(root, file));
    const original = await fs.readFile(path.join(root, file), 'utf8');
    // A Windows checkout may convert LF to CRLF without changing the source.
    const content = original.replace(/\r\n/g, '\n');
    if (digest(content) !== expected.sha256) throw new Error(`File berbeda dari Hydra ${metadata.ref}: ${file}. Tidak ada perubahan yang ditulis.`);
    sources[file] = content;
    originals[file] = original;
  }
  const patched = integrate(sources);
  const writes = [];
  const overlay = path.join(project, 'integration/overlay');
  for (const file of await walk(overlay)) writes.push([path.relative(overlay, file), await fs.readFile(file)]);
  for (const file of await walk(path.join(project, 'module'))) writes.push([path.join('src/main/services/personal-cloud-backup/core', path.basename(file)), await fs.readFile(file)]);
  const config = writes.find(([file]) => file === path.join('src/main/services/personal-cloud-backup/core', 'onedrive.mjs'));
  if (!config) throw new Error('Modul OneDrive tidak ditemukan.');
  config[1] = Buffer.from(config[1].toString().replace("process.env.HYDRA_ONEDRIVE_CLIENT_ID || ''", JSON.stringify(clientId)));
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
    for (const [file, source] of Object.entries(originals)) {
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
      if (file in sources) await fs.writeFile(path.join(root, file), originals[file]);
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
