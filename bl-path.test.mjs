import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

let resolveBlPath;
try {
  ({ resolveBlPath } = await import('./bl-path.js'));
} catch {}

test('finds bl in the current user npm bin when PATH does not contain it', async t => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-image-gen-home-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const executable = join(home, '.npm-global', 'bin', 'bl');
  await mkdir(join(home, '.npm-global', 'bin'), { recursive: true });
  await writeFile(executable, '');

  assert.equal(
    resolveBlPath?.('', { env: { PATH: '' }, home, platformName: 'darwin' }),
    executable
  );
});

test('finds bl in PATH before using a home-directory fallback', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-image-gen-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = join(root, 'first');
  const second = join(root, 'second');
  const executable = join(second, 'bl');
  await mkdir(first);
  await mkdir(second);
  await writeFile(executable, '');

  assert.equal(
    resolveBlPath('', { env: { PATH: `${first}:${second}` }, home: root, platformName: 'linux' }),
    executable
  );
});

test('Windows PATH uses semicolons and discovers the npm command shim', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-image-gen-windows-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = join(root, 'first');
  const second = join(root, 'second');
  const executable = join(second, 'bl.cmd');
  await mkdir(first);
  await mkdir(second);
  await writeFile(executable, '');

  assert.equal(
    resolveBlPath('', { env: { PATH: `${first};${second}` }, home: root, platformName: 'win32' }),
    executable
  );
});

test('Windows falls back to the current user npm directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-image-gen-windows-home-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appData = join(root, 'AppData', 'Roaming');
  const executable = join(appData, 'npm', 'bl.cmd');
  await mkdir(join(appData, 'npm'), { recursive: true });
  await writeFile(executable, '');

  assert.equal(
    resolveBlPath('', { env: { PATH: '', APPDATA: appData }, home: root, platformName: 'win32' }),
    executable
  );
});
