import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

function runYarn(args, options) {
  return new Promise((resolve, reject) => {
    // All arguments come from the fixed commands below, never from user text.
    const child = spawn('yarn', args, { ...options, shell: process.platform === 'win32', stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`yarn ${args[0]} failed (${code ?? signal})`)));
  });
}

export async function buildWindows(root, { mode = 'quick', compression = 'normal', reportDir = path.resolve('package'), run = runYarn } = {}) {
  if (!['quick', 'installer'].includes(mode)) throw new Error('Unknown Windows build mode');
  if (!['normal', 'store'].includes(compression)) throw new Error('Unknown compression setting');
  const started = performance.now();
  const report = { mode, compression, source: process.env.GITHUB_SHA ?? null, stages: [] };
  await fs.mkdir(reportDir, { recursive: true });
  async function timed(name, args) {
    const start = performance.now();
    const stage = { name, passed: false };
    report.stages.push(stage);
    console.log(`Starting ${name}`);
    try {
      await run(args, { cwd: path.resolve(root), env: { ...process.env, HYDRA_BUILD_COMPRESSION: compression } });
      stage.passed = true;
    } finally {
      stage.seconds = Number(((performance.now() - start) / 1000).toFixed(3));
      console.log(`${name}: ${stage.passed ? 'passed' : 'failed'} in ${stage.seconds}s`);
    }
  }
  try {
    // Wait for both outcomes: a typecheck failure must never produce an installer.
    const results = await Promise.allSettled([
      timed('typecheck', ['typecheck']),
      timed('compile', ['electron-vite', 'build']),
    ]);
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Windows validation failed');
    const args = ['electron-builder', '--win', '--x64', '--config', 'personal-backup-builder.cjs', '--publish', 'never'];
    if (mode === 'quick') args.push('--dir');
    await timed(mode === 'quick' ? 'unpacked' : 'installer-and-portable', args);
    report.passed = true;
  } finally {
    report.passed ??= false;
    report.seconds = Number(((performance.now() - started) / 1000).toFixed(3));
    await fs.writeFile(path.join(reportDir, 'build-timings.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const rows = report.stages.map(stage => `| ${stage.name} | ${stage.seconds} | ${stage.passed ? 'passed' : 'failed'} |`).join('\n');
      await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Windows ${mode} (${compression})\n\n| Stage | Seconds | Result |\n|---|---:|---|\n${rows}\n\nBuild wall time: ${report.seconds}s. Typecheck and compile overlap.\n`);
    }
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/build-windows.mjs <Hydra source> [quick|installer] [normal|store]');
  await buildWindows(process.argv[2], { mode: process.argv[3], compression: process.argv[4] });
}
