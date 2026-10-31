import { execFile } from 'node:child_process';
import path from 'node:path';

export const runWithoutInput = (executable, args, options) => new Promise((resolve, reject) => {
  const child = execFile(executable, args, options, (error, stdout, stderr) => {
    if (error) reject(Object.assign(error, { stdout, stderr }));
    else resolve({ stdout, stderr });
  });
  // `find --steam-id` reads positional names from stdin until EOF, even with an ID.
  child.stdin?.on('error', () => {});
  child.stdin?.end();
});

export class Ludusavi {
  constructor(executable, configDirectory, runner = runWithoutInput) {
    if (!path.isAbsolute(executable)) throw new Error('Pilih lokasi absolut ludusavi.exe.');
    this.executable = executable;
    this.configDirectory = configDirectory;
    this.runner = runner;
  }
  async invoke(args) {
    // Argument array, no shell; isolated config; never invokes backup or restore.
    let stdout;
    let failure;
    try {
      ({ stdout } = await this.runner(this.executable, ['--config', this.configDirectory, '--no-manifest-update', ...args], { windowsHide: true, timeout: 90000, maxBuffer: 16 * 1024 * 1024 }));
    } catch (error) {
      // Ludusavi returns useful JSON with a nonzero exit code for unknown games.
      stdout = error.stdout;
      failure = error;
    }
    let output;
    try { output = JSON.parse(stdout); } catch { /* Explain process failures below. */ }
    if (output?.errors?.unknownGames?.length) throw new Error('Perlu pengaturan: game atau Steam ID belum dikenali oleh database Ludusavi. Perbarui database lokasi save atau pilih lokasi save manual.');
    if (failure) {
      if (failure.killed) throw new Error('Deteksi Ludusavi melewati batas waktu. Coba lagi atau pilih lokasi save manual.');
      if (failure.code === 'ENOENT') throw new Error('Ludusavi tidak ditemukan. Pilih kembali ludusavi.exe di pengaturan.');
      if (output?.errors?.someGamesFailed) throw new Error('Ludusavi gagal memindai sebagian save. Periksa akses file atau pilih lokasi save manual.');
      const detail = String(failure.stderr || '').trim().slice(0, 1200);
      throw new Error(`Ludusavi gagal dijalankan${detail ? `: ${detail}` : '. Periksa lokasi ludusavi.exe dan izin aksesnya.'}`);
    }
    if (!output || typeof output.games !== 'object' || !output.games || output.errors?.someGamesFailed) throw new Error('Ludusavi gagal mengenali atau memindai game.');
    return output;
  }
  async updateManifest() {
    await this.runner(this.executable, ['--config', this.configDirectory, 'manifest', 'update'], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
  }
  async discover(game) {
    const selector = game.shop === 'steam' && /^\d+$/.test(game.objectId) ? ['--steam-id', game.objectId] : ['--', game.title];
    const found = await this.invoke(['find', '--api', '--backup', ...selector]);
    const titles = Object.keys(found.games);
    if (titles.length !== 1) throw new Error('Perlu pengaturan: game tidak dikenali secara pasti. Pilih lokasi save manual.');
    const result = await this.invoke(['backup', '--preview', '--api', '--no-cloud-sync', '--', titles[0]]);
    const info = result.games[titles[0]];
    if (!info || !info.files || info.decision === 'Ignored' || info.decision === 'Cancelled') throw new Error('Perlu pengaturan: lokasi save tidak tersedia.');
    const files = Object.entries(info.files).filter(([, value]) => !value.ignored && value.change !== 'Removed');
    if (files.some(([, value]) => value.failed)) throw new Error('Sebagian file save tidak dapat dibaca oleh Ludusavi.');
    if (!files.length) throw new Error('Perlu pengaturan: belum ada file save yang dikenali. Save Registry tidak didukung.');
    return { title: titles[0], selections: files.map(([file]) => ({ path: file })) };
  }
}
