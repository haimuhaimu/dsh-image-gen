import { spawn } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { platform } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

function commandFor(blPath, args) {
  if (platform() !== 'win32') return [blPath, args]
  const extension = extname(blPath).toLowerCase()
  if (['.js', '.mjs', '.cjs'].includes(extension)) {
    return [process.execPath, [blPath, ...args]]
  }
  if (!['.cmd', '.bat'].includes(extension)) return [blPath, args]

  // npm shims require cmd.exe, which can reinterpret multiline prompts.
  // Launch the installed Bailian Node entry directly instead of using a shell.
  if (basename(blPath).toLowerCase() === 'bl.cmd') {
    const binDir = dirname(blPath)
    for (const packageDir of [join(binDir, 'node_modules', 'bailian-cli'), join(binDir, '..', 'bailian-cli')]) {
      try {
        const root = realpathSync(packageDir)
        const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
        const entry = metadata.bin?.bl
        if (metadata.name !== 'bailian-cli' || typeof entry !== 'string' || isAbsolute(entry)) continue
        const script = realpathSync(resolve(root, entry))
        const withinPackage = relative(root, script)
        if (!withinPackage || withinPackage === '..' || withinPackage.startsWith(`..${sep}`) || isAbsolute(withinPackage)) continue
        if (statSync(script).isFile()) return [process.execPath, [script, ...args]]
      } catch {
        // Missing or invalid metadata is not a reason to fall back to a shell.
      }
    }
  }
  throw new Error('Cannot launch Windows batch CLI: install bailian-cli with npm, or set blPath to its JavaScript entry or a native executable')
}

/** Run the CLI with bounded lifetime and collected output. */
export function runBl(blPath, args, { signal, timeoutMs = 600000 }) {
  return new Promise((resolveRun, reject) => {
    if (signal?.aborted) {
      reject(new Error('generate_image cancelled'))
      return
    }
    const [command, commandArgs] = commandFor(blPath, args)
    const child = spawn(command, commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    const onAbort = () => child.kill('SIGTERM')
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }
    child.on('error', (err) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (code === 0) resolveRun({ stdout, stderr })
      else reject(new Error(`bl exited ${code}: ${stderr.trim() || stdout.slice(0, 300)}`))
    })
  })
}
