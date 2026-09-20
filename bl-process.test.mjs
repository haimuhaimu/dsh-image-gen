import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { resolveBlPath } from './bl-path.js';
import { runBl } from './bl-process.js';

// These values must reach the CLI as literal arguments, not shell syntax.
const args = ['image', 'generate', '--prompt',
  'a "red cat" & blue dog | (城市) <night> ^light\r\nsecond line\nthird line',
  '--negative-prompt', 'no blur; no $substitution; literal %COMSPEC% !TEXT!',
  '--size', '1024*1024', '--seed', '0'];

for (const install of ['global npm', 'node_modules/.bin']) {
  test(`executes the resolved ${install} CLI and preserves prompt arguments`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'dsh launch space-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const bin = join(root, install);
    await mkdir(bin, { recursive: true });
    const packageDir = install === 'global npm'
      ? join(bin, 'node_modules', 'bailian-cli')
      : join(bin, '..', 'bailian-cli');
    await mkdir(join(packageDir, 'dist'), { recursive: true });
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({
      name: 'bailian-cli', bin: { bl: 'dist/bailian.mjs' },
    }));
    const script = join(packageDir, 'dist', 'bailian.mjs');
    await writeFile(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
    const windows = platform() === 'win32';
    const executable = join(bin, windows ? 'bl.cmd' : 'bl');
    await writeFile(executable, windows
      ? `@"${process.execPath}" "%~dp0${relative(bin, script)}" %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${script.replaceAll("'", "'\\''")}' "$@"\n`,
    { mode: 0o755 });
    const resolved = resolveBlPath('', { env: { PATH: bin }, home: root });
    const { stdout, stderr } = await runBl(resolved, args, { timeoutMs: 5000 });
    assert.deepEqual(JSON.parse(stdout), args);
    assert.equal(stderr, '');
  });
}

for (const termination of ['abort', 'timeout']) {
  test(`the actual CLI process exits after ${termination}`, { timeout: 20000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lifetime-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const packageDir = join(root, 'node_modules', 'bailian-cli');
    await mkdir(packageDir, { recursive: true });
    const script = join(packageDir, 'cli.mjs');
    const pidFile = join(root, 'pid');
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({
      name: 'bailian-cli', bin: { bl: 'cli.mjs' },
    }));
    await writeFile(script, `import {writeFileSync} from 'node:fs';\nwriteFileSync(process.argv[2], String(process.pid));\nsetInterval(() => {}, 100);`);
    const executable = join(root, platform() === 'win32' ? 'bl.cmd' : 'bl');
    await writeFile(executable, platform() === 'win32'
      ? `@"${process.execPath}" "%~dp0node_modules\\bailian-cli\\cli.mjs" %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`, { mode: 0o755 });
    const controller = new AbortController();
    const completion = runBl(executable, [pidFile], {
      signal: controller.signal, timeoutMs: termination === 'timeout' ? 7000 : 15000,
    });
    // Attach a rejection handler immediately; intentional abort must not be unhandled.
    const rejected = assert.rejects(completion);
    let pid;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try { pid = Number(await readFile(pidFile, 'utf8')); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(pid, 'CLI must start before lifetime behavior can be tested');
    t.after(() => { try { process.kill(pid); } catch {} });
    if (termination === 'abort') controller.abort();
    await rejected;
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  });
}

test('an already-cancelled request never starts the CLI', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-preabort-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = join(root, 'started');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runBl(process.execPath, ['--input-type=module', '-e',
    `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'started');`],
  { signal: controller.signal, timeoutMs: 1000 }), /cancelled/);
  await new Promise(resolve => setTimeout(resolve, 500));
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});

test('Windows runs a configured JavaScript CLI directly', { skip: platform() !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh direct entry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, 'cli.mjs');
  await writeFile(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  const { stdout } = await runBl(script, args, { timeoutMs: 5000 });
  assert.deepEqual(JSON.parse(stdout), args);
});

for (const metadata of [null, { name: 'other-cli', bin: { bl: 'cli.mjs' } },
  { name: 'bailian-cli', bin: { bl: '../../outside.mjs' } }]) {
  test(`Windows rejects unsupported batch launch (${JSON.stringify(metadata)})`,
    { skip: platform() !== 'win32' }, async t => {
      const root = await mkdtemp(join(tmpdir(), 'dsh-invalid-shim-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      const packageDir = join(root, 'node_modules', 'bailian-cli');
      await mkdir(packageDir, { recursive: true });
      await writeFile(join(packageDir, 'cli.mjs'), 'process.stdout.write("wrong CLI");');
      // A real outside file proves containment is checked, not just existence.
      await writeFile(join(root, 'outside.mjs'), 'process.stdout.write("outside package");');
      if (metadata) await writeFile(join(packageDir, 'package.json'), JSON.stringify(metadata));
      const shim = join(root, 'bl.cmd');
      await writeFile(shim, '@echo wrong CLI\r\n');
      await assert.rejects(runBl(shim, args, { timeoutMs: 5000 }), /Cannot launch Windows batch.*blPath/);
    });
}
