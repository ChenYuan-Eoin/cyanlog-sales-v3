import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ExportData } from './word-generator'

export interface PdfExportResult {
  success: boolean
  outputPath?: string
  error?: string
  anchored?: number
  unlocated?: string[]
}

export async function generateAnnotatedPdf(inputPath: string, data: ExportData): Promise<PdfExportResult> {
  return new Promise((resolve) => {
    const outputPath = path.join(os.tmpdir(), `contract-export-${randomUUID()}.pdf`)
    const scriptPath = path.join(process.cwd(), 'lib', 'export', 'pdf-annotator.py')
    if (!fs.existsSync(inputPath) || !fs.existsSync(scriptPath)) {
      resolve({ success: false, error: 'PDF 源文件或批注运行时不存在' })
      return
    }

    const child = spawn(process.env.PYTHON_PATH || 'python3', [
      scriptPath,
      inputPath,
      outputPath,
      JSON.stringify({
        export_mode: data.export_mode,
        decision_drafts: data.decision_drafts || [],
        annotations: data.annotations || [],
      }),
    ])
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: PdfExportResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (!result.success && fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
      resolve(result)
    }
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ success: false, error: 'PDF 批注运行时超过 60 秒，已停止' })
    }, 60_000)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => finish({ success: false, error: error.message }))
    child.on('close', (code) => {
      if (code !== 0) {
        finish({ success: false, error: stderr || 'PDF 批注运行时执行失败' })
        return
      }
      try {
        const result = JSON.parse(stdout.trim()) as PdfExportResult
        finish(result.success && fs.existsSync(outputPath) ? { ...result, outputPath } : {
          success: false,
          error: result.error || 'PDF 批注运行时未生成有效文件',
        })
      } catch {
        finish({ success: false, error: stderr || 'PDF 批注运行时返回了无效结果' })
      }
    })
  })
}
