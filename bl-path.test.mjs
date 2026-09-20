import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

import { resolveBlPath } from './bl-path.js';

test('finds bl in the current user npm bin when PATH does not contain it', async t => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-image-gen-home-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const executable = join(home, '.npm-global', 'bin', 'bl');
  await mkdir(join(home, '.npm-global', 'bin'), { recursive: true });
  await writeFile(executable, '', { mode: 0o755 });

  assert.equal(
    resolveBlPath('', { env: { PATH: '' }, home, platformName: 'darwin' }),
    executable
  );
});

test('finds bl in PATH before using a home-directory fallback', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-image-gen-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = join(root, 'first');
  const second = join(root, 'second');
  const platformName = platform();
  const executable = join(second, platformName === 'win32' ? 'bl.cmd' : 'bl');
  await mkdir(first);
  await mkdir(second);
  await writeFile(executable, '', { mode: 0o755 });

  assert.equal(
    resolveBlPath('', { env: { PATH: [first, second].join(delimiter) }, home: root, platformName }),
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

test('skips a directory named bl before a usable PATH candidate', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-path-directory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = join(root, 'first');
  const second = join(root, 'second');
  const name = platform() === 'win32' ? 'bl.cmd' : 'bl';
  await mkdir(join(first, name), { recursive: true });
  await mkdir(second);
  const executable = join(second, name);
  await writeFile(executable, '', { mode: 0o755 });
  assert.equal(resolveBlPath('', {
    env: { PATH: [first, second].join(delimiter) }, home: root,
  }), executable);
});

test('skips a non-executable Unix file before a usable PATH candidate', {
  skip: platform() === 'win32',
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-path-permission-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = join(root, 'first');
  const second = join(root, 'second');
  await mkdir(first);
  await mkdir(second);
  await writeFile(join(first, 'bl'), '', { mode: 0o644 });
  const executable = join(second, 'bl');
  await writeFile(executable, '', { mode: 0o755 });
  assert.equal(resolveBlPath('', {
    env: { PATH: [first, second].join(delimiter) }, home: root,
  }), executable);
});

test('preserves executable symlinks in Unix PATH', {
  skip: platform() === 'win32',
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-path-symlink-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, 'cli');
  await writeFile(target, '', { mode: 0o755 });
  const link = join(root, 'bl');
  await symlink(target, link);
  assert.equal(resolveBlPath('', { env: { PATH: root }, home: root }), link);
});
