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

export interface WordExportResult {
  success: boolean
  outputPath?: string
  error?: string
}

/**
 * Generate Word document with comments using Python script
 */
export async function generateWordDocument(
  inputDocxPath: string,
  comments: ExportComment[]
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

    // Spawn Python process
    const pythonProcess = spawn('python3', [
      scriptPath,
      actualInputPath,
      outputPath,
      JSON.stringify(comments),
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
