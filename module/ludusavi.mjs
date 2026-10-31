import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const run = promisify(execFile);

export class Ludusavi {
  constructor(executable, configDirectory, runner = run) {
    if (!path.isAbsolute(executable)) throw new Error('Pilih lokasi absolut ludusavi.exe.');
    this.executable = executable;
    this.configDirectory = configDirectory;
    this.runner = runner;
  }
  async invoke(args) {
    // Argument array, no shell; isolated config; never invokes backup or restore.
    const { stdout } = await this.runner(this.executable, ['--config', this.configDirectory, '--no-manifest-update', ...args], { windowsHide: true, timeout: 90000, maxBuffer: 16 * 1024 * 1024 });
    const output = JSON.parse(stdout);
    if (!output || typeof output.games !== 'object' || !output.games || output.errors?.someGamesFailed || output.errors?.unknownGames?.length) throw new Error('Ludusavi gagal mengenali atau memindai game.');
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
