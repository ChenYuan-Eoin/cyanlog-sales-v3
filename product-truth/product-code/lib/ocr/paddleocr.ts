// REQ:F008
// PURPOSE: PaddleOCR wrapper for local OCR processing

import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

export interface OCResult {
  text: string
  confidence: number
}

/**
 * Extract text from PDF/image using PaddleOCR
 * Requires paddleocr Python package: pip install paddlepaddle paddleocr
 */
export async function extractTextWithPaddleOCR(filePath: string): Promise<OCResult> {
  return new Promise((resolve, reject) => {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      reject(new Error(`File not found: ${filePath}`))
      return
    }

    // PaddleOCR Python script path
    const scriptPath = path.join(process.cwd(), 'lib', 'ocr', 'paddle_ocr.py')

    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      reject(new Error('PaddleOCR Python script not found'))
      return
    }

    const pythonProcess = spawn('python3', [scriptPath, filePath])

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
        reject(new Error(`PaddleOCR failed: ${errorOutput || 'Unknown error'}`))
        return
      }

      try {
        const result = JSON.parse(output.trim())
        resolve({
          text: result.text || '',
          confidence: result.confidence || 0,
        })
      } catch {
        resolve({
          text: output.trim(),
          confidence: 0.8, // Default confidence when JSON parse fails
        })
      }
    })

    pythonProcess.on('error', (error) => {
      reject(new Error(`Failed to start PaddleOCR: ${error.message}`))
    })
  })
}

/**
 * Fallback: Use cloud OCR API (e.g., Google Vision, Azure, etc.)
 */
export async function extractTextWithCloudOCR(fileUrl: string): Promise<OCResult> {
  // Example implementation for Google Vision API
  const apiKey = process.env.GOOGLE_VISION_API_KEY

  if (!apiKey) {
    throw new Error('Google Vision API Key not configured')
  }

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { source: { imageUri: fileUrl } },
          features: [{ type: 'TEXT_DETECTION' }],
        }],
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`Cloud OCR failed: ${response.statusText}`)
  }

  const data = await response.json()
  const text = data.responses?.[0]?.fullTextAnnotation?.text || ''
  const confidence = data.responses?.[0]?.textAnnotations?.[0]?.confidence || 0.9

  return { text, confidence }
}
