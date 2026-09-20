import { accessSync, constants, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export function resolveBlPath(configured, { env = process.env, home = homedir(), platformName = platform() } = {}) {
  if (configured && configured !== 'bl') return configured;
  const separator = platformName === 'win32' ? ';' : ':';
  const executableNames = platformName === 'win32' ? ['bl.cmd', 'bl.exe', 'bl'] : ['bl'];
  const isExecutable = candidate => {
    try {
      if (!statSync(candidate).isFile()) return false;
      if (platformName !== 'win32') accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  const pathHit = (env.PATH || '')
    .split(separator)
    .filter(Boolean)
    .flatMap(directory => executableNames.map(name => join(directory, name)))
    .find(isExecutable);
  if (pathHit) return pathHit;
  const fallbackCandidates = platformName === 'win32'
    ? [env.APPDATA && join(env.APPDATA, 'npm', 'bl.cmd')]
    : [
        join(home, '.npm-global', 'bin', 'bl'),
        join(home, '.local', 'bin', 'bl'),
        '/usr/local/bin/bl',
        '/opt/homebrew/bin/bl'
      ];
  return fallbackCandidates.filter(Boolean).find(isExecutable) || 'bl';
}
