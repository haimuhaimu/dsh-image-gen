import spawn from 'cross-spawn'

/** Run the CLI with bounded lifetime and collected output. */
export function runBl(blPath, args, { signal, timeoutMs = 600000 }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(blPath, args, {
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
      if (signal.aborted) {
        clearTimeout(timer)
        reject(new Error('generate_image cancelled'))
        return
      }
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
