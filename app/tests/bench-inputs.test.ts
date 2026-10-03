import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { verifiedBenchmarkInputs } from './helpers/bench-inputs';

it('бенч не пропускает отсутствующие и изменённые входы; дополнительные планы не меняют core', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-bench-'));
  const hash = createHash('sha256').update('fixture').digest('hex');
  const entry = { id: 'sample', image: 'plan.png', imageSha256: hash, truthSha256: hash };
  try {
    expect(() => verifiedBenchmarkInputs(dir, [entry])).toThrow(/dataset/);
    fs.mkdirSync(path.join(dir, 'sample'));
    fs.writeFileSync(path.join(dir, 'sample/plan.png'), 'fixture');
    expect(() => verifiedBenchmarkInputs(dir, [entry])).toThrow();
    fs.writeFileSync(path.join(dir, 'sample/truth.json'), 'fixture');
    expect(verifiedBenchmarkInputs(dir, [entry])).toEqual([entry]);
    fs.writeFileSync(path.join(dir, 'sample/truth.json'), 'changed');
    expect(() => verifiedBenchmarkInputs(dir, [entry])).toThrow(/input changed/);
    fs.writeFileSync(path.join(dir, 'sample/truth.json'), 'fixture');
    fs.mkdirSync(path.join(dir, 'extra'));
    expect(verifiedBenchmarkInputs(dir, [entry])).toEqual([entry]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
