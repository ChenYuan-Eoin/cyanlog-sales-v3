import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type LmStudioCliStatus =
  | 'ready'
  | 'disabled_in_vercel'
  | 'missing_cli'
  | 'model_not_loaded'
  | 'probe_failed'

type ExecFileLike = typeof execFile

export function isActualVercelRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL === '1' && Boolean(env.VERCEL_URL || env.VERCEL_REGION)
}

export function resolveLmStudioCliPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.LMSTUDIO_CLI_PATH || join(env.HOME || homedir(), '.lmstudio/bin/lms')
}

function cliAvailable(cliPath: string): boolean {
  return existsSync(cliPath)
}

function modelNeedle(model: string): string {
  return model.trim().toLowerCase()
}

export async function probeLmStudioCliModel(
  model: string,
  options: {
    env?: NodeJS.ProcessEnv
    execFileImpl?: ExecFileLike
    timeoutMs?: number
  } = {}
): Promise<LmStudioCliStatus> {
  const env = options.env || process.env
  if (isActualVercelRuntime(env)) return 'disabled_in_vercel'

  const cliPath = resolveLmStudioCliPath(env)
  if (!cliAvailable(cliPath)) return 'missing_cli'

  const execFileImpl = options.execFileImpl || execFile
  const timeoutMs = options.timeoutMs ?? 1500

  return new Promise((resolve) => {
    execFileImpl(cliPath, ['ps'], {
      timeout: timeoutMs,
      maxBuffer: 256 * 1024,
      env,
    }, (error, stdout) => {
      if (error) {
        resolve('probe_failed')
        return
      }

      const output = String(stdout || '').toLowerCase()
      resolve(output.includes(modelNeedle(model)) ? 'ready' : 'model_not_loaded')
    })
  })
}

export async function generateWithLmStudioCli(input: {
  model: string
  system: string
  prompt: string
  timeoutMs: number
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
}): Promise<string> {
  const env = input.env || process.env
  if (isActualVercelRuntime(env)) {
    throw new Error('LM Studio CLI is disabled in Vercel runtime')
  }

  const cliPath = resolveLmStudioCliPath(env)
  if (!cliAvailable(cliPath)) {
    throw new Error(`LM Studio CLI not found at ${cliPath}`)
  }

  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, [
      'chat',
      input.model,
      '--system-prompt',
      input.system,
      '--prompt',
      input.prompt,
      '--ttl',
      '600',
      '--dont-fetch-catalog',
      '--yes',
    ], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const cleanup = () => {
      input.signal?.removeEventListener('abort', onAbort)
      clearTimeout(timeout)
    }

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    const onAbort = () => {
      child.kill('SIGTERM')
      finish(() => reject(new Error('LM Studio CLI request aborted')))
    }

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      finish(() => reject(new Error('LM Studio CLI request timeout')))
    }, input.timeoutMs)

    input.signal?.addEventListener('abort', onAbort)

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      finish(() => reject(error))
    })
    child.on('close', (code) => {
      if (settled) return
      const text = stdout.trim()
      if (code === 0 && text.length > 0) {
        finish(() => resolve(text))
        return
      }

      const detail = stderr.trim() || stdout.trim() || `exit ${code}`
      finish(() => reject(new Error(`LM Studio CLI failed: ${detail}`)))
    })
  })
}
