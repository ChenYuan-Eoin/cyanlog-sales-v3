// REQ:F008-F014
// PURPOSE: OCR text extraction and key information parsing

import { extractContractText } from '@/lib/contracts/text-extraction'

const DOCUMENT_PARSE_PLACEHOLDERS = [
  '[图片OCR需要接入云端视觉 OCR 或本地 OCR 引擎]',
  '[PDF未能提取可复制文本，可能是扫描件，需要接入云端视觉 OCR]',
  '[不支持的文件格式]',
] as const

export interface OCRResult {
  tenderNo?: string
  tenderName?: string
  budget?: string
  deadline?: string
  publisher?: string
  contact?: string
  confidence: number
}

export function isDocumentParsePlaceholder(text: string): boolean {
  return DOCUMENT_PARSE_PLACEHOLDERS.some((placeholder) => text.trim() === placeholder)
}

// Extract key information from text using regex patterns
export function extractKeyInfo(text: string): OCRResult {
  const result: OCRResult = {
    confidence: 0,
  }

  // 招标编号
  const tenderNoMatch = text.match(/招标编号[：:]\s*([A-Za-z0-9\-]+)/)
  if (tenderNoMatch) {
    result.tenderNo = tenderNoMatch[1].trim()
    result.confidence += 25
  }

  // 项目名称
  const tenderNameMatch = text.match(/项目名称[：:]\s*([^\n]+)/)
  if (tenderNameMatch) {
    result.tenderName = tenderNameMatch[1].trim()
    result.confidence += 25
  }

  // 预算金额
  const budgetMatch = text.match(/预算[：:]\s*([^\n]+)/)
  if (budgetMatch) {
    result.budget = budgetMatch[1].trim()
    result.confidence += 25
  }

  // 截止日期
  const deadlineMatch = text.match(/截止[日期]*[：:]\s*(\d{4}[年/-]\d{1,2}[月/-]\d{1,2}[日]?)/)
  if (deadlineMatch) {
    result.deadline = deadlineMatch[1].trim()
    result.confidence += 25
  }

  // 招标人/采购人
  const publisherMatch = text.match(/(采购人|招标人)[：:]\s*([^\n]+)/)
  if (publisherMatch) {
    result.publisher = publisherMatch[2].trim()
  }

  // 联系方式
  const contactMatch = text.match(/联系[方式电话]*[：:]\s*([^\n]+)/)
  if (contactMatch) {
    result.contact = contactMatch[1].trim()
  }

  return result
}

// Parse document content. Text-like PDF/DOCX extraction reuses the contract
// extractor so tender upload does not silently degrade to placeholder text.
export async function parseDocument(buffer: Buffer, mimeType: string, fileName = 'document'): Promise<string> {
  const extracted = extractContractText(buffer, fileName, mimeType)
  if (extracted) return extracted

  if (mimeType.startsWith('image/')) {
    return '[图片OCR需要接入云端视觉 OCR 或本地 OCR 引擎]'
  }

  if (mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
    return '[PDF未能提取可复制文本，可能是扫描件，需要接入云端视觉 OCR]'
  }

  return '[不支持的文件格式]'
}
