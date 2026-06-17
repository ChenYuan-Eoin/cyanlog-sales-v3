// REQ:F007
// PURPOSE: Word document export wrapper - Node.js calls Python script

import { spawn } from 'child_process'
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
  strategy_name?: string
  strategy_code?: string
}

export interface WordExportResult {
  success: boolean
  outputPath?: string
  error?: string
}

/**
 * Generate Word document with structured report + comments using Python script
 */
export async function generateWordDocument(
  inputDocxPath: string,
  data: ExportData | ExportComment[]
): Promise<WordExportResult> {
  return new Promise((resolve) => {
    // Create temp output path
    const tempDir = os.tmpdir()
    const outputPath = path.join(tempDir, `contract-export-${Date.now()}.docx`)

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
      : { ...data, clauses: data.clauses || [], annotations: data.annotations || [] }

    // Spawn Python process
    const pythonProcess = spawn('python3', [
      scriptPath,
      actualInputPath,
      outputPath,
      JSON.stringify(exportData),
    ])

    let output = ''
    let errorOutput = ''

    pythonProcess.stdout.on('data', (data) => {
      output += data.toString()
    })

    pythonProcess.stderr.on('data', (data) => {
      errorOutput += data.toString()
    })

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        resolve({
          success: false,
          error: errorOutput || 'Python script failed',
        })
        return
      }

      try {
        const result = JSON.parse(output.trim())
        if (result.success) {
          resolve({
            success: true,
            outputPath,
          })
        } else {
          resolve({
            success: false,
            error: result.error || 'Unknown error',
          })
        }
      } catch {
        // If output is not valid JSON, check if file was created
        if (fs.existsSync(outputPath)) {
          resolve({
            success: true,
            outputPath,
          })
        } else {
          resolve({
            success: false,
            error: errorOutput || 'Failed to generate document',
          })
        }
      }
    })

    pythonProcess.on('error', (error) => {
      resolve({
        success: false,
        error: error.message,
      })
    })
  })
}
