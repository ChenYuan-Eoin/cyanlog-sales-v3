import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { ExportData, WordExportResult } from './word-generator'

type IsolationBackend = 'macos-sandbox-exec' | 'bubblewrap'
const LOCAL_PROOF_SCOPE = 'trusted-fixture-local-proof'
const MAX_CAPTURED_LOG_BYTES = 256 * 1024

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/)
const legacyDocWorkerProofSchema = z.object({
  success: z.literal(true),
  anchored: z.number().int().positive().max(80),
  unlocated: z.array(z.string()).max(80),
  source_hash: hashSchema,
  output_hash: hashSchema,
  source_text_hash: hashSchema,
  output_text_hash: hashSchema,
  macro_streams_verified: z.number().int().nonnegative(),
  object_streams_verified: z.number().int().nonnegative(),
  page_geometry: z.array(z.tuple([
    z.number().finite().positive(),
    z.number().finite().positive(),
  ])).min(1).max(2_000),
  native_comments_added: z.number().int().positive().max(80),
  target_load_macro_policy: z.literal('MacroExecutionMode=0'),
  conversion_macro_canary: z.literal('not-proven'),
  active_content_policy: z.literal('disabled'),
  network_isolation: z.enum(['remote-denied-local-ipc-only', 'network-namespace-unshared']),
  isolation_backend: z.enum(['macos-sandbox-exec', 'bubblewrap']),
  proof_scope: z.literal(LOCAL_PROOF_SCOPE),
}).strict().refine(
  (proof) => proof.anchored === proof.native_comments_added && proof.unlocated.length === 0,
  { message: 'anchored/native comment counts and unlocated evidence must close exactly' },
)
const legacyDocWorkerFailureSchema = z.object({
  success: z.literal(false),
  error_code: z.string().min(1).max(100),
  error: z.string().min(1).max(2_000),
}).passthrough()

type LegacyDocWorkerProof = z.infer<typeof legacyDocWorkerProofSchema>

export interface LegacyDocExportResult extends WordExportResult {
  errorCode?: string
  proof?: LegacyDocWorkerProof
}

interface LegacyDocRuntimeConfig {
  pythonPath: string
  sofficePath: string
  backend: IsolationBackend
}

function sha256File(filePath: string) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function runtimeConfig(): LegacyDocRuntimeConfig | null {
  if (process.env.DOC_ADAPTER_ENABLED !== 'true') return null
  if (process.env.DOC_ADAPTER_PROOF_SCOPE !== LOCAL_PROOF_SCOPE) return null

  // The current adapter is deliberately limited to pinned local fixtures.
  // Production needs a separate service that contains Python, LibreOffice and
  // every verifier inside one minimal container/microVM security boundary.
  if (process.env.NODE_ENV === 'production') return null

  const backend = process.env.DOC_ADAPTER_ISOLATION_BACKEND
  if (backend !== 'macos-sandbox-exec' && backend !== 'bubblewrap') return null

  const pythonPath = process.env.DOC_ADAPTER_PYTHON_PATH || process.env.PYTHON_PATH || ''
  const sofficePath = process.env.DOC_ADAPTER_SOFFICE_PATH || ''
  if (!path.isAbsolute(pythonPath) || !path.isAbsolute(sofficePath)) return null
  if (!fs.existsSync(pythonPath) || !fs.existsSync(sofficePath)) return null
  return { pythonPath, sofficePath, backend }
}

export function legacyDocAdapterConfigured() {
  return runtimeConfig() !== null
}

export function validateLegacyDocWorkerProof(value: unknown) {
  return legacyDocWorkerProofSchema.safeParse(value).success
}

function parseWorkerOutput(stdout: string): unknown {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]) as unknown
    } catch {
      // LibreOffice diagnostics may precede the final JSON result.
    }
  }
  return null
}

export async function generateLegacyDocDocument(
  inputPath: string,
  data: ExportData,
): Promise<LegacyDocExportResult> {
  const config = runtimeConfig()
  if (!config) {
    return {
      success: false,
      errorCode: 'DOC_ADAPTER_NOT_PROVEN',
      error: 'DOC 隔离适配器未配置；不会在普通 Next.js 进程中直接打开二进制 Word 文件',
    }
  }
  if (!inputPath.toLowerCase().endsWith('.doc') || !fs.existsSync(inputPath)) {
    return { success: false, errorCode: 'DOC_SOURCE_INVALID', error: 'DOC 源文件不存在或扩展名不正确' }
  }

  const scriptPath = path.join(process.cwd(), 'lib', 'export', 'legacy-doc-worker.py')
  if (!fs.existsSync(scriptPath)) {
    return { success: false, errorCode: 'DOC_WORKER_MISSING', error: 'DOC 隔离 Worker 脚本不存在' }
  }

  const id = randomUUID()
  const payloadPath = path.join(os.tmpdir(), `doc-adapter-${id}.json`)
  const outputPath = path.join(os.tmpdir(), `contract-export-${id}.doc`)
  fs.writeFileSync(payloadPath, JSON.stringify(data), { mode: 0o600 })

  return new Promise((resolve) => {
    const child = spawn(config.pythonPath, [
      scriptPath,
      '--input', inputPath,
      '--output', outputPath,
      '--payload', payloadPath,
      '--backend', config.backend,
      '--soffice', config.sofficePath,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        PYTHONNOUSERSITE: '1',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    })

    let stdout = ''
    let stderr = ''
    let logOverflow = false
    let settled = false
    const finish = (result: LegacyDocExportResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath)
      if (!result.success && fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
      resolve(result)
    }
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ success: false, errorCode: 'DOC_WORKER_TIMEOUT', error: 'DOC 隔离 Worker 超过 120 秒，已停止' })
    }, 120_000)

    const capture = (channel: 'stdout' | 'stderr', chunk: Buffer) => {
      if (settled || logOverflow) return
      const value = chunk.toString()
      const totalBytes = Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + Buffer.byteLength(value)
      if (totalBytes > MAX_CAPTURED_LOG_BYTES) {
        logOverflow = true
        child.kill('SIGKILL')
        finish({ success: false, errorCode: 'DOC_WORKER_LOG_LIMIT', error: 'DOC Worker 日志超过安全上限，已停止' })
        return
      }
      if (channel === 'stdout') stdout += value
      else stderr += value
    }
    child.stdout.on('data', (chunk: Buffer) => { capture('stdout', chunk) })
    child.stderr.on('data', (chunk: Buffer) => { capture('stderr', chunk) })
    child.on('error', () => {
      finish({ success: false, errorCode: 'DOC_WORKER_START_FAILED', error: 'DOC 本地证明进程无法启动' })
    })
    child.on('close', (code) => {
      const output = parseWorkerOutput(stdout)
      const failure = legacyDocWorkerFailureSchema.safeParse(output)
      if (code !== 0 || failure.success) {
        const errorCode = failure.success ? failure.data.error_code : 'DOC_WORKER_FAILED'
        finish({
          success: false,
          errorCode,
          error: `DOC 本地证明失败（${errorCode}）`,
        })
        return
      }
      const parsedProof = legacyDocWorkerProofSchema.safeParse(output)
      if (!parsedProof.success) {
        finish({
          success: false,
          errorCode: 'DOC_WORKER_PROOF_INVALID',
          error: 'DOC Worker 返回的本地证明结构不完整',
        })
        return
      }
      const proof = parsedProof.data
      if (!fs.existsSync(outputPath)) {
        finish({ success: false, errorCode: 'DOC_WORKER_OUTPUT_MISSING', error: 'DOC Worker 未生成输出文件', proof })
        return
      }

      const actualSourceHash = sha256File(inputPath)
      const actualOutputHash = sha256File(outputPath)
      const proofValid = proof.source_hash === actualSourceHash
        && proof.output_hash === actualOutputHash
        && proof.source_hash !== proof.output_hash
        && proof.source_text_hash === proof.output_text_hash
        && proof.isolation_backend === config.backend

      if (!proofValid) {
        finish({
          success: false,
          errorCode: 'DOC_WORKER_PROOF_INVALID',
          error: 'DOC Worker 返回的隔离、身份或文件往返证据不完整',
          proof,
        })
        return
      }

      finish({
        success: true,
        outputPath,
        anchored: proof.anchored,
        unlocated: proof.unlocated || [],
        proof,
      })
    })
  })
}
