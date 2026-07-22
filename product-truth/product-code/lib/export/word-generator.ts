// REQ:F007
// PURPOSE: Word document export wrapper - Node.js calls Python script

import { spawn } from 'child_process'
import { randomUUID } from 'node:crypto'
import path from 'path'
import fs from 'fs'
import os from 'os'

export interface ExportComment {
  level: 'red' | 'yellow' | 'green'
  title: string
  description: string
  suggestion: string
}

export interface ExportClause {
  id: string
  clause_number: string | null
  clause_title: string | null
  clause_text: string
  risk_level: string
  risk_category: string | null
  risk_description: string | null
  legal_basis: string | null
  suggestion: string | null
  suggested_text?: string | null
  start_offset?: number | null
  end_offset?: number | null
  review_status?: string | null
  position: number
}

export interface ExportAnnotation {
  id: string
  start_offset: number
  end_offset: number
  selected_text: string | null
  comment: string
  category: string | null
  priority: string | null
  status: string
  author_id: string | null
  created_at: string
  source_anchor?: {
    kind: 'text' | 'region' | 'point'
    page: number
    point?: { x: number; y: number }
    region?: { x: number; y: number; width: number; height: number }
  } | null
  source_storage_path?: string | null
  source_hash?: string | null
}

export interface ExportRiskCard {
  id: string
  level: 'red' | 'yellow' | 'green' | 'white'
  title: string
  description?: string | null
  suggestion?: string | null
  clause_ref?: string | null
  status?: string | null
  position_start?: number | null
  position_end?: number | null
}

export interface ExportAskItem {
  id: string
  ask_code?: string | null
  clause_ref?: string | null
  risk_name?: string | null
  initial_level?: 'red' | 'yellow' | 'green' | null
  question_text?: string | null
  qualified_std?: string | null
  status?: string | null
  ask_responses?: Array<{
    id: string
    response_text?: string | null
    responder_name?: string | null
    responder_role?: string | null
  }>
}

export interface ExportData {
  summary?: string
  risks: ExportComment[]
  risk_summary?: {
    total_clauses: number
    critical_risks: number
    high_risks: number
    medium_risks: number
    low_risks: number
    compliance_score: number
    strategy_code?: string
  }
  compliance_check?: {
    missing_required_clauses: string[]
    dangerous_clauses: string[]
    ambiguous_clauses: string[]
    unbalanced_clauses: string[]
    party_a_consistency: string
    party_b_consistency: string
    issues: string[]
  }
  effectiveness_analysis?: string
  clauses?: ExportClause[]
  annotations?: ExportAnnotation[]
  risk_cards?: ExportRiskCard[]
  ask_items?: ExportAskItem[]
  strategy_name?: string
  strategy_code?: string
  export_mode?: string
  decision_drafts?: Array<{
    source_anchor?: {
      page?: number
      start?: number
      end?: number
      clause_ref?: string | null
      excerpt?: string | null
      exact_text?: string | null
      locator?: 'rendered' | 'provisional'
    } | null
    customer_comment?: string | null
    revision_text?: string | null
    negotiation_result?: 'customer_agreed' | 'customer_feedback' | 'exception_requested' | null
    resolution_strategy_snapshot?: Record<string, unknown> | null
    status?: string
  }>
}

export interface WordExportResult {
  success: boolean
  outputPath?: string
  error?: string
  anchored?: number
  revisions?: number
  unlocated?: string[]
}

/**
 * Generate a source DOCX with native Word comments.
 */
export async function generateWordDocument(
  inputDocxPath: string,
  data: ExportData | ExportComment[]
): Promise<WordExportResult> {
  return new Promise((resolve) => {
    // Create temp output path
    const tempDir = os.tmpdir()
    const outputExtension = inputDocxPath.toLowerCase().endsWith('.docm') ? 'docm' : 'docx'
    const outputPath = path.join(tempDir, `contract-export-${randomUUID()}.${outputExtension}`)

    // Python script path
    const scriptPath = path.join(process.cwd(), 'lib', 'export', 'word-generator.py')

    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      resolve({
        success: false,
        error: 'Python script not found',
      })
      return
    }

    // Prepare input path (if not exists, pass empty string)
    const actualInputPath = fs.existsSync(inputDocxPath) ? inputDocxPath : ''

    // 兼容老接口（仅传 comments 数组）
    const exportData: ExportData = Array.isArray(data)
      ? { risks: data, clauses: [], annotations: [] }
      : {
          ...data,
          clauses: data.clauses || [],
          annotations: data.annotations || [],
          risk_cards: data.risk_cards || [],
          ask_items: data.ask_items || [],
          decision_drafts: data.decision_drafts || [],
        }

    // Spawn Python process
    const pythonProcess = spawn(process.env.PYTHON_PATH || 'python3', [
      scriptPath,
      actualInputPath,
      outputPath,
      JSON.stringify(exportData),
    ])

    let output = ''
    let errorOutput = ''
    let settled = false
    const finish = (result: WordExportResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (!result.success && fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
      resolve(result)
    }
    const timeout = setTimeout(() => {
      pythonProcess.kill('SIGKILL')
      finish({ success: false, error: 'Word 批注运行时超过 60 秒，已停止' })
    }, 60_000)

    pythonProcess.stdout.on('data', (data) => {
      output += data.toString()
    })

    pythonProcess.stderr.on('data', (data) => {
      errorOutput += data.toString()
    })

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        finish({
          success: false,
          error: errorOutput || 'Python script failed',
        })
        return
      }

      try {
        const result = JSON.parse(output.trim())
        if (result.success && fs.existsSync(outputPath)) {
          finish({
            success: true,
            outputPath,
            anchored: result.anchored,
            revisions: result.revisions,
            unlocated: result.unlocated,
          })
        } else {
          finish({
            success: false,
            error: result.error || 'Word 批注运行时未生成有效文件',
          })
        }
      } catch {
        finish({
          success: false,
          error: errorOutput || 'Word 批注运行时返回了无效结果',
        })
      }
    })

    pythonProcess.on('error', (error) => {
      finish({
        success: false,
        error: error.message,
      })
    })
  })
}
