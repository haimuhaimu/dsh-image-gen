import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveBlPath } from './bl-path.js';
import { runBl } from './bl-process.js';

// These values must reach the CLI as literal arguments, not shell syntax.
const args = ['image', 'generate', '--prompt',
  'a "red cat" & blue dog | (城市) <night> ^light',
  '--negative-prompt', 'no blur; no $substitution', '--seed', '0'];

for (const install of ['global npm', 'node_modules/.bin']) {
  test(`executes the resolved ${install} CLI and preserves prompt arguments`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'dsh launch space-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const bin = join(root, install);
    await mkdir(bin, { recursive: true });
    const script = join(bin, 'cli.cjs');
    await writeFile(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
    const windows = platform() === 'win32';
    const executable = join(bin, windows ? 'bl.cmd' : 'bl');
    await writeFile(executable, windows
      ? `@"${process.execPath}" "%~dp0cli.cjs" %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${script.replaceAll("'", "'\\''")}' "$@"\n`,
    { mode: 0o755 });
    const resolved = resolveBlPath('', { env: { PATH: bin }, home: root });
    const { stdout, stderr } = await runBl(resolved, args, { timeoutMs: 5000 });
    assert.deepEqual(JSON.parse(stdout), args);
    assert.equal(stderr, '');
  });
}
