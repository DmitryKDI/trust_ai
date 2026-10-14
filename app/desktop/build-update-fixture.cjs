// CI-only installer for exercising a real installed-app upgrade. Never published.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const filename = path.resolve('package.json');
const original = fs.readFileSync(filename, 'utf8');
const config = JSON.parse(original);
const parts = config.version.split('.').map(Number);
if (parts.length !== 3 || parts.some(x => !Number.isSafeInteger(x))) throw new Error('Fixture requires a stable version.');
config.version = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
try {
  fs.writeFileSync(filename, JSON.stringify(config, null, 2) + '\n');
  const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', 'nsis', '--x64', '--publish', 'never', '--config.directories.output=release-update-fixture'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Update fixture build failed.');
} finally { fs.writeFileSync(filename, original); }
