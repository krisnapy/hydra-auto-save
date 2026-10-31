import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32') throw new Error('Smoke test ini memerlukan Windows.');
const executable = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3] || 'package');
await fs.mkdir(output, { recursive: true });
const server = net.createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const child = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
child.stdout.on('data', data => { logs += data; });
child.stderr.on('data', data => { logs += data; });
let socket;
let pending = new Map();
let sequence = 0;
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
  if (!snapshot || !Array.isArray(snapshot.operations) || typeof snapshot.enabled !== 'boolean' || !snapshot.ludusavi?.endsWith('ludusavi.exe')) throw new Error('IPC atau Ludusavi dalam paket tidak tersedia.');
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
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(output, 'Personal-Backup-Windows.png'), Buffer.from(screenshot.data, 'base64'));
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
