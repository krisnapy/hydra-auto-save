import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';

// Fixture insertion is restricted to a disposable Windows CI profile.
if (process.platform !== 'win32' || process.env.CI !== 'true') throw new Error('Pengujian ini hanya boleh dijalankan di Windows CI.');
if (!process.argv[2]) throw new Error('Lokasi aplikasi portable diperlukan.');
const executable = path.resolve(process.argv[2]);
const output = path.resolve('visual-results');
await fs.mkdir(path.join(output, 'screenshots'), { recursive: true });
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'hydra-game-ui-'));
const roaming = path.join(scratch, 'Roaming');
const local = path.join(scratch, 'Local');
const userData = path.join(scratch, 'profile');
await Promise.all([roaming, local].map(folder => fs.mkdir(folder, { recursive: true })));
const server = net.createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const child = spawn(executable, [`--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
  env: { ...process.env, APPDATA: roaming, LOCALAPPDATA: local }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', data => { logs += data; });
child.stderr.on('data', data => { logs += data; });
let browser;
let page;
try {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (child.exitCode !== null) throw new Error(`Aplikasi berhenti (${child.exitCode}).`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
    } catch { /* Wait for the packaged renderer. */ }
    await delay(1000);
  }
  if (!browser) throw new Error('Aplikasi tidak terbuka dalam 90 detik.');
  await expect.poll(() => browser.contexts().flatMap(context => context.pages()).some(item => item.url().startsWith('file:') && item.url().includes('renderer')), { timeout: 45000 }).toBe(true);
  page = browser.contexts().flatMap(context => context.pages()).find(item => item.url().startsWith('file:') && item.url().includes('renderer'));
  await page.waitForFunction(() => Boolean(window.personalBackup && window.electron?.addCustomGameToLibrary));
  const snapshot = await page.evaluate(() => window.personalBackup.invoke({ action: 'snapshot' }));
  const settingsFile = path.join(userData, 'personal-cloud-backup', 'settings.json');
  if (snapshot.setup?.games.length !== 0 || snapshot.enabled) throw new Error('Profil CI terisolasi belum terbukti; penyisipan fixture dibatalkan.');
  const settings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
  if (settings.deviceId !== snapshot.deviceId || Object.keys(settings.games).length !== 0) throw new Error('Identitas profil tidak sesuai folder sementara.');
  const dummy = path.join(scratch, 'Visual-Fixture-Do-Not-Run.exe');
  await fs.writeFile(dummy, 'Visual test fixture. Never execute.');
  const game = await page.evaluate(file => window.electron.addCustomGameToLibrary('UJI TAMPILAN - Game Contoh', file), dummy);
  if (game?.shop !== 'custom' || game.executablePath !== dummy || !game.objectId) throw new Error('Game contoh tidak tersimpan.');
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.evaluate(id => { location.hash = `/game/custom/${id}`; }, game.objectId);
  const panel = page.locator('section.personal-backup');
  await expect(panel).toBeVisible({ timeout: 45000 });
  await expect(panel.getByText('Lokasi save belum dikenali.', { exact: false })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Backup sekarang', exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Pulihkan', exact: true })).toBeDisabled();
  if (!await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)) throw new Error('Panel melampaui lebar halaman game.');
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'screenshots/windows-hydra-game-page.png'), animations: 'disabled' });
  await panel.screenshot({ path: path.join(output, 'screenshots/windows-hydra-game-panel.png'), animations: 'disabled' });
  await fs.writeFile(path.join(output, 'windows-game-page.json'), JSON.stringify({
    passed: true, testedAt: new Date().toISOString(), applicationVersion: JSON.parse(await fs.readFile('package.json', 'utf8')).version,
    buildRun: process.env.TESTED_BUILD_RUN ?? null, applicationSource: process.env.TESTED_SOURCE ?? null,
    isolatedProfile: true, route: '/game/custom/:objectId', scenario: 'unconfigured',
    scope: 'Real packaged Hydra game page with a dummy custom game; no game execution, save backup, restore, or cloud upload.',
  }, null, 2));
  console.log('Lulus: panel backup tampil di halaman game Hydra Windows dengan profil CI terisolasi.');
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(output, 'windows-failure.png') }).catch(() => {});
    await fs.writeFile(path.join(output, 'windows-failure.txt'), `${error.stack}\n${await page.locator('body').innerText().catch(() => '')}`);
  }
  throw error;
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F']).catch(() => {});
  await fs.writeFile(path.join(output, 'windows-game-page.log'), logs);
  await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
}
