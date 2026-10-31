import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const source = path.resolve(process.argv[2] || 'package');
const destination = path.resolve(process.argv[3] || 'downloads');
const hash = async file => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
};
const lines = (await fs.readFile(path.join(source, 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/);
if (lines.length !== 2) throw new Error('Expected exactly two executable checksums.');
const packages = new Set();
const sizes = [];
for (const line of lines) {
  const match = /^([a-f0-9]{64})  (Hydra-Personal-Backup-[\w.-]+-windows-x64-(setup|portable)\.exe)$/i.exec(line);
  if (!match) throw new Error('Unexpected checksum entry.');
  const [, expected, filename, kind] = match;
  if (packages.has(kind)) throw new Error('Duplicate package kind.');
  packages.add(kind);
  const original = path.join(source, filename);
  if (await hash(original) !== expected.toLowerCase()) throw new Error(`Checksum mismatch: ${filename}`);
  const output = path.join(destination, kind);
  await fs.mkdir(output, { recursive: true });
  await fs.copyFile(original, path.join(output, filename));
  await fs.copyFile(path.join(source, 'README.md'), path.join(output, 'README.md'));
  await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), `${expected.toLowerCase()}  ${filename}\n`);
  if (await hash(path.join(output, filename)) !== expected.toLowerCase()) throw new Error(`Copy mismatch: ${filename}`);
  sizes.push({ kind, filename, bytes: (await fs.stat(original)).size, sha256: expected.toLowerCase() });
}
if (!packages.has('setup') || !packages.has('portable')) throw new Error('Missing installer or portable.');
console.log(JSON.stringify(sizes, null, 2));
