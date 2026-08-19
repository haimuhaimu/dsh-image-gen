import { spawn } from 'node:child_process'
import { readFile, mkdtemp, rm, copyFile, mkdir } from 'node:fs/promises'
import { tmpdir, homedir, platform } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'image-gen'

export const inject = ['tools', 'attachments']

/** 生成图的持久保存目录（自动弹出与手动查看共用）。 */
const OUTPUT_DIR = join(homedir(), '.dsh', 'image-gen')

/** 用系统默认看图器打开图片（失败静默，不阻塞工具返回）。 */
function openInViewer(filePath) {
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open'
  const args = platform() === 'win32' ? ['', filePath] : [filePath]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, shell: platform() === 'win32' })
    child.on('error', () => {})
    child.unref()
  } catch { /* 打开失败不影响生成结果 */ }
}

/**
 * 配置项（cordis.patch.yml 的 config 块）：
 *   blPath: string   bl CLI 路径；留空按 PATH 查找（含常见安装位置回退）
 *   autoOpen: bool   生成后是否自动用系统看图器弹出（默认 true）
 *   defaultModel / defaultSize / defaultWatermark: 可选默认值
 */
const DEFAULT_BL_CANDIDATES = [
  'bl',
  '/Users/bytedance/.npm-global/bin/bl',
  '/usr/local/bin/bl',
  '/opt/homebrew/bin/bl',
]

/** 解析 bl CLI 路径：配置优先，其次 PATH，最后常见安装位置。 */
function resolveBlPath(configured) {
  if (configured && configured !== 'bl') return configured
  // PATH 里有没有 bl
  const pathDirs = (process.env.PATH || '').split(':').filter(Boolean)
  const hit = pathDirs.map((dir) => join(dir, 'bl')).find((p) => {
    try {
      // 轻量检查可执行文件存在（不跟随 symlink 语义的近似）
      return require('node:fs').existsSync(p)
    } catch {
      return false
    }
  })
  if (hit) return hit
  const fallback = DEFAULT_BL_CANDIDATES.slice(1).find((p) => {
    try {
      return require('node:fs').existsSync(p)
    } catch {
      return false
    }
  })
  return fallback || 'bl'
}

/** 运行 bl CLI，收集 stdout/stderr；非零退出抛错。 */
function runBl(blPath, args, { signal, timeoutMs = 600000 }) {
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

/** bl 的 JSON 输出可能带日志前缀；从最后一行 { 开始解析。失败时把整段输出当保存路径处理。 */
function parseBlJson(stdout) {
  const lines = stdout.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith('{')) continue
    try {
      return JSON.parse(line)
    } catch {
      // 继续向前找
    }
  }
  // 非 JSON 输出（--quiet 模式）：每行是一个保存路径
  const paths = stdout.split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.png'))
  if (paths.length > 0) {
    return { saved: paths }
  }
  throw new Error(`无法解析 bl 输出: ${stdout.slice(0, 300)}`)
}

function mediaTypeOf(filename) {
  const ext = basename(filename).split('.').pop()?.toLowerCase()
  if (ext === 'jpeg' || ext === 'jpg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/png'
}

export function apply(ctx, config = {}) {
  const blPath = resolveBlPath(config.blPath || process.env.BL_PATH)
  const autoOpen = config.autoOpen !== false

  ctx.tools.register(defineTool({
    name: 'generate_image',
    description:
      'Generate an image from a detailed text prompt using Aliyun Bailian Qwen-Image (via the bl CLI). ' +
      'The image is saved as a conversation attachment AND written to ~/.dsh/image-gen/, then auto-opened in the system image viewer so it is visible immediately. ' +
      'Write detailed prompts: subject, style, composition, lighting, mood.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'Detailed description of the image to generate.',
      },
      size: {
        type: 'string',
        description: 'Image size: ratio (3:4, 16:9, 1:1) or pixels (1024*1024, 2048*2048). Default: 1024*1024.',
      },
      model: {
        type: 'string',
        description: 'Model id. Default: qwen-image-3.0. Alternatives: wan2.6-t2i, z-image-turbo.',
      },
      n: {
        type: 'number',
        description: 'Number of images to generate (1-6). Default: 1.',
      },
      negative_prompt: {
        type: 'string',
        description: 'Elements to exclude from the image.',
      },
      seed: {
        type: 'number',
        description: 'Random seed for reproducible results.',
      },
      watermark: {
        type: 'boolean',
        description: 'Keep watermark. Default: false.',
      },
    },
    isConcurrencySafe: () => true,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: {
            type: 'object',
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'number', required: true },
              width: { type: 'number', required: true },
              height: { type: 'number', required: true },
              name: { type: 'string' },
            },
          },
          file: { type: 'string' },
        },
      },
      render: (args, value) => [
        { type: 'image', attachment: value.ref },
        {
          type: 'text',
          text: `Generated image (${value.ref.width}×${value.ref.height}, ${(value.ref.bytes / 1024).toFixed(0)} KB)` +
            (value.file ? ` — ${value.file}` : ''),
        },
      ],
    },
    async execute(args, exec) {
      const workDir = await mkdtemp(join(tmpdir(), 'dsh-image-gen-'))
      try {
        const outDir = join(workDir, 'out')
        const blArgs = [
          'image', 'generate',
          '--prompt', args.prompt,
          '--out-dir', outDir,
          '--output', 'json',
          '--quiet',
        ]
        if (args.size) blArgs.push('--size', args.size)
        if (args.model) blArgs.push('--model', args.model)
        if (args.n) blArgs.push('--n', String(args.n))
        if (args.negative_prompt) blArgs.push('--negative-prompt', args.negative_prompt)
        if (args.seed !== undefined) blArgs.push('--seed', String(args.seed))
        blArgs.push('--watermark', args.watermark === true ? 'true' : 'false')

        const { stdout } = await runBl(blPath, blArgs, { signal: exec.signal })
        const parsed = parseBlJson(stdout)
        const saved = parsed.saved?.[0]
        if (!saved) throw new Error(`bl 未返回保存路径: ${stdout.slice(0, 300)}`)

        const filePath = resolve(outDir, saved)
        const data = await readFile(filePath)
        const mediaType = mediaTypeOf(filePath)
        const ref = await ctx.attachments.saveImage({
          data: new Uint8Array(data),
          mediaType,
          name: basename(filePath),
        })
        // 持久化到固定目录并自动弹出看图器，保证"生成即看到"。
        let persistentPath = basename(filePath)
        try {
          await mkdir(OUTPUT_DIR, { recursive: true })
          persistentPath = join(OUTPUT_DIR, basename(filePath))
          await copyFile(filePath, persistentPath)
          if (autoOpen) openInViewer(persistentPath)
        } catch { /* 持久化/打开失败不影响附件结果 */ }
        exec.agent?.inject({
          content: [{
            type: 'text',
            text: `已通过 bl CLI（${args.model || 'qwen-image-3.0'}）生成图片，保存为附件并写入 ${persistentPath}。`,
          }],
          source: { kind: 'plugin', plugin: 'image-gen' },
        })
        return { ref, file: persistentPath }
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {})
      }
    },
  }))
}
