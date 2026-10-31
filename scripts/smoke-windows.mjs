import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32') throw new Error('Smoke test ini memerlukan Windows.');
const executable = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3] || 'package');
await fs.mkdir(output, { recursive: true });
const server = net.createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const startedAt = Date.now();
const metrics = { kind: process.argv.includes('--tray') ? 'installed' : 'portable', startedAt: new Date(startedAt).toISOString() };
const child = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
child.stdout.on('data', data => { logs += data; });
child.stderr.on('data', data => { logs += data; });
let socket;
let pending = new Map();
let sequence = 0;
const connectToPage = async page => {
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const reply = JSON.parse(String(event.data));
    if (reply.id && pending.has(reply.id)) {
      const { resolve, reject, timer } = pending.get(reply.id);
      clearTimeout(timer); pending.delete(reply.id);
      if (reply.error) reject(new Error(reply.error.message)); else resolve(reply.result);
    }
  });
};
try {
  let page;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (child.exitCode !== null) throw new Error(`Aplikasi berhenti saat startup (${child.exitCode}).`);
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = pages.find(item => item.type === 'page' && item.url.startsWith('file:') && item.url.includes('renderer'));
      if (page) break;
    } catch { /* Wait for Electron's debugging endpoint. */ }
    await delay(1000);
  }
  if (!page) throw new Error('Renderer lokal tidak terbuka dalam 90 detik.');
  metrics.rendererMs = Date.now() - startedAt;
  await connectToPage(page);
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const reply = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
    return reply.result.value;
  };
  let snapshot;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate('Boolean(window.personalBackup)')) {
      snapshot = await evaluate('window.personalBackup.invoke({ action: "snapshot" })');
      break;
    }
    await delay(1000);
  }
  if (!snapshot || !Array.isArray(snapshot.setup?.games) || !Array.isArray(snapshot.interrupted) || !Array.isArray(snapshot.operations) || typeof snapshot.enabled !== 'boolean' || !snapshot.ludusavi?.endsWith('ludusavi.exe')) throw new Error('IPC atau Ludusavi dalam paket tidak tersedia.');
  metrics.ipcMs = Date.now() - startedAt;
  await evaluate('location.hash = "/settings"');
  let visible = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    visible = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Personal Cloud Backup');
      button?.click();
      const section = document.querySelector('section.personal-backup');
      return Boolean(section?.textContent.includes('Folder backup') && section?.textContent.includes('Auto Backup') && section?.textContent.includes('Tidak ada operasi yang berjalan.'));
    })()`);
    if (visible) break;
    await delay(1000);
  }
  if (!visible) throw new Error('Pengaturan Personal Cloud Backup tidak tampil.');
  const guideReady = await evaluate(`(() => {
    const section = document.querySelector('section.personal-backup');
    const finish = [...section.querySelectorAll('button')].find(button => button.textContent.trim() === 'Aktifkan dan selesaikan');
    return Boolean(section.textContent.includes('Mulai backup pribadi') && section.textContent.includes('Buat backup percobaan') && finish?.disabled);
  })()`);
  if (!guideReady) throw new Error('Panduan pengaturan awal tidak tampil atau bisa selesai tanpa backup percobaan.');
  metrics.settingsMs = Date.now() - startedAt;
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(output, 'Personal-Backup-Windows.png'), Buffer.from(screenshot.data, 'base64'));
  if (process.argv.includes('--tray')) {
    const measure = async () => JSON.parse((await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./measure-windows-processes.ps1', import.meta.url)), '-RootPid', String(child.pid)], { timeout: 30000, windowsHide: true })).stdout);
    metrics.open = await measure();
    await evaluate('setTimeout(() => window.close(), 0); true');
    let closed = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (!pages.some(item => item.id === page.id)) { closed = true; break; }
      await delay(1000);
    }
    if (!closed || child.exitCode !== null) throw new Error('Menutup jendela tidak mempertahankan proses tray tanpa renderer utama.');
    await delay(3000);
    const before = await measure();
    await delay(5000);
    metrics.tray = await measure();
    metrics.tray.cpuSecondsOver5s = metrics.tray.processes.reduce((total, item) => total + Math.max(0, item.cpuSeconds - (before.processes.find(previous => previous.id === item.id)?.cpuSeconds ?? item.cpuSeconds)), 0);
    const reopenedAt = Date.now();
    const reopen = spawn(executable, [], { stdio: 'ignore' });
    reopen.unref();
    let reopenedPage;
    for (let attempt = 0; attempt < 30; attempt++) {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      reopenedPage = pages.find(item => item.type === 'page' && item.url.includes('renderer') && item.id !== page.id);
      if (reopenedPage) break;
      await delay(1000);
    }
    if (!reopenedPage) throw new Error('Jendela tidak dapat dibuka kembali dari proses tray.');
    metrics.reopenRendererMs = Date.now() - reopenedAt;
    await connectToPage(reopenedPage);
    let reopenedSnapshot;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await evaluate('Boolean(window.personalBackup)')) {
        reopenedSnapshot = await evaluate('window.personalBackup.invoke({ action: "snapshot", lightweight: true })');
        break;
      }
      await delay(1000);
    }
    if (reopenedSnapshot?.deviceId !== snapshot.deviceId) throw new Error('Layanan backup tidak tersedia setelah jendela dibuka kembali.');
    metrics.reopenIpcMs = Date.now() - reopenedAt;
  }
  await fs.writeFile(path.join(output, `Startup-${metrics.kind}.json`), JSON.stringify(metrics, null, 2));
  console.log('Startup metrics:', JSON.stringify(metrics));
  console.log('Lulus: aplikasi Windows terbuka, renderer lokal tampil, IPC backup aktif, dan Ludusavi ditemukan.');
} finally {
  socket?.close();
  for (const { timer } of pending.values()) clearTimeout(timer);
  if (child.exitCode === null) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    await new Promise(resolve => killer.once('exit', resolve));
  }
  await fs.writeFile(path.join(output, 'startup.log'), logs);
}
