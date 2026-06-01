// REQ:F008
// PURPOSE: OCR text extraction and key information parsing

export interface OCRResult {
  tenderNo?: string
  tenderName?: string
  budget?: string
  deadline?: string
  publisher?: string
  contact?: string
  confidence: number
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

// Parse document content (placeholder for actual PDF parsing)
export async function parseDocument(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === 'text/plain') {
    return buffer.toString('utf-8')
  }

  if (mimeType === 'application/pdf') {
    // For now, return a placeholder
    // In production, use pdf-parse or similar
    return '[PDF解析需要安装pdf-parse包]'
  }

  if (mimeType.startsWith('image/')) {
    // For images, would need actual OCR
    return '[图片OCR需要安装tesseract.js]'
  }

  return '[不支持的文件格式]'
}
