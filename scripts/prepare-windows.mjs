import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyHydra } from './apply-hydra.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));

export async function prepareWindows(target) {
  const root = path.resolve(target);
  // Read and validate these anchors before the integration writes any files.
  const managerPath = 'src/main/services/update-manager.ts';
  const restartPath = 'src/main/events/autoupdater/restart-and-install-update.ts';
  const manager = await fs.readFile(path.join(root, managerPath), 'utf8');
  const restart = await fs.readFile(path.join(root, restartPath), 'utf8');
  const managerAnchor = '  public static async checkForUpdates() {';
  const restartAnchor = 'export const restartAndInstallUpdate = () => {';
  for (const [text, anchor] of [[manager, managerAnchor], [restart, restartAnchor]]) {
    if (text.split(anchor).length !== 2) throw new Error('Sumber pembaruan Hydra tidak cocok.');
  }
  await applyHydra(root);
  // Official launcher updates would remove this custom integration.
  await fs.writeFile(path.join(root, managerPath), manager.replace(managerAnchor, `${managerAnchor}\n    return false; // Personal Backup: updates are installed manually.`));
  await fs.writeFile(path.join(root, restartPath), restart.replace(restartAnchor, `${restartAnchor}\n  return; // Personal Backup: never install official updates over this build.`));
  await fs.copyFile(path.join(project, 'integration/windows-builder.cjs'), path.join(root, 'personal-backup-builder.cjs'));
  await fs.copyFile(path.join(project, 'docs/panduan-windows.md'), path.join(root, 'Personal-Backup-README.md'));
  return root;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Pemakaian: node scripts/prepare-windows.mjs <source Hydra 4.3.0>');
  console.log(`Sumber Windows disiapkan: ${await prepareWindows(process.argv[2])}`);
}
