import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

interface Entry { id: string; image: string; imageSha256: string; truthSha256: string }
export function verifiedBenchmarkInputs(directory: string, expected: Entry[]): Entry[] {
  const actual = fs.readdirSync(directory).filter(id => fs.statSync(path.join(directory, id)).isDirectory()).sort();
  const ids = expected.map(e => e.id).sort();
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !actual.includes(id)))
    throw new Error('Benchmark core dataset differs from the frozen input hashes');
  for (const entry of expected) {
    for (const [file, hash] of [[entry.image, entry.imageSha256], ['truth.json', entry.truthSha256]]) {
      const bytes = fs.readFileSync(path.join(directory, entry.id, file));
      if (createHash('sha256').update(bytes).digest('hex') !== hash)
        throw new Error(`Benchmark input changed: ${entry.id}/${file}`);
    }
  }
  return expected;
}
