import { watch } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { safePath } from './engine.mjs';

const within = (parent, child) => {
  const relative = path.relative(parent, child);
  return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

export class SaveMonitor {
  constructor(onChange, watchDirectory = watch) {
    this.onChange = onChange;
    this.watchDirectory = watchDirectory;
    this.entries = new Map();
  }
  async sync(configurations) {
    for (const [id, entry] of this.entries) {
      if (!configurations[id] || entry.key !== JSON.stringify(configurations[id])) this.remove(id);
    }
    for (const [id, roots] of Object.entries(configurations)) {
      // Recreate broken/missing-root watches on the next heartbeat.
      if (this.entries.get(id)?.healthy) continue;
      this.remove(id);
      const entry = { key: JSON.stringify(roots), watchers: [], healthy: true };
      this.entries.set(id, entry);
      const targets = new Map();
      try {
        for (const root of roots) {
          await safePath(root.path);
          let parent = path.dirname(root.path);
          while (!(await fs.stat(parent).catch(error => { if (error.code === 'ENOENT') return null; throw error; }))?.isDirectory()) {
            const next = path.dirname(parent);
            if (next === parent) throw new Error('Folder pemantauan tidak tersedia.');
            parent = next;
          }
          targets.set(parent, false);
          if (root.kind === 'directory' && (await fs.stat(root.path).catch(error => { if (error.code === 'ENOENT') return null; throw error; }))?.isDirectory()) targets.set(root.path, true);
          else if (root.kind === 'directory' || parent !== path.dirname(root.path)) entry.healthy = false;
        }
        for (const [directory, recursive] of targets) {
          const watcher = this.watchDirectory(directory, { recursive, persistent: false }, (event, name) => {
            if (this.entries.get(id) !== entry) return;
            const changed = name == null ? null : path.resolve(directory, String(name));
            if (!changed || roots.some(root => within(root.path, changed) || within(changed, root.path))) {
              if (event === 'rename') entry.healthy = false;
              this.onChange(id);
            }
          });
          watcher.on('error', () => { entry.healthy = false; this.onChange(id); });
          entry.watchers.push(watcher);
        }
      } catch { entry.healthy = false; }
    }
  }
  healthy(id) { return this.entries.get(id)?.healthy === true; }
  remove(id) {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    for (const watcher of entry?.watchers ?? []) watcher.close();
  }
  close() { for (const id of this.entries.keys()) this.remove(id); }
}
