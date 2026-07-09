import { inflateRawSync } from 'zlib'

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length || 0
}

export function isLikelyReadableContractText(text: string | null | undefined): boolean {
  const normalized = normalizeText(text || '')
  if (!normalized) return false

  const compact = normalized.replace(/\s+/g, '')
  if (compact.length < 4) return false

  const controlOrReplacementCount = countMatches(compact, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFD]/g)
  if (controlOrReplacementCount > 0) return false

  const cjkCount = countMatches(compact, /[\u3400-\u9fff\uf900-\ufaff]/g)
  const asciiAlphaNumericCount = countMatches(compact, /[A-Za-z0-9]/g)
  const latin1ArtifactCount = countMatches(compact, /[\u00c0-\u00ff]/g)
  const readableCount = cjkCount + asciiAlphaNumericCount
  const latin1ArtifactRatio = latin1ArtifactCount / compact.length
  const readableRatio = readableCount / compact.length

  if (latin1ArtifactRatio > 0.12 && cjkCount < 4 && readableRatio < 0.72) {
    return false
  }

  return readableCount >= 4 || readableRatio >= 0.35
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function decodePdfString(raw: string): string {
  const unescaped = raw.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_match, value: string) => {
    if (/^[0-7]/.test(value)) {
      return String.fromCharCode(parseInt(value, 8))
    }

    const escapes: Record<string, string> = {
      n: '\n',
      r: '\r',
      t: '\t',
      b: '\b',
      f: '\f',
      '(': '(',
      ')': ')',
      '\\': '\\',
    }
    return escapes[value] ?? value
  })

  const utf8 = Buffer.from(unescaped, 'latin1').toString('utf8')
  return utf8.includes('\uFFFD') ? unescaped : utf8
}

function extractTextFromPdf(buffer: Buffer): string | null {
  const source = buffer.toString('latin1')
  const chunks: string[] = []
  const textOperatorPattern = /\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g
  const arrayTextPattern = /\[((?:\s*\((?:\\.|[^\\)])*\)\s*-?\d*\.?\d*)+)\]\s*TJ/g

  for (const match of source.matchAll(textOperatorPattern)) {
    chunks.push(decodePdfString(match[1]))
  }

  for (const match of source.matchAll(arrayTextPattern)) {
    for (const item of match[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)) {
      chunks.push(decodePdfString(item[1]))
    }
  }

  const extracted = normalizeText(chunks.join('\n'))
  if (isLikelyReadableContractText(extracted)) return extracted

  const utf8Text = normalizeText(buffer.toString('utf8').replace(/[^\p{L}\p{N}\p{P}\p{Zs}\n]/gu, ' '))
  return isLikelyReadableContractText(utf8Text) && /[\u4e00-\u9fff]/.test(utf8Text) ? utf8Text : null
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset
    }
  }
  return -1
}

function readZipEntry(buffer: Buffer, entryName: string): Buffer | null {
  const eocdOffset = findEndOfCentralDirectory(buffer)
  if (eocdOffset < 0) return null

  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12)
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  let cursor = centralDirectoryOffset
  const end = centralDirectoryOffset + centralDirectorySize

  while (cursor < end && buffer.readUInt32LE(cursor) === 0x02014b50) {
    const compressionMethod = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')

    if (name === entryName) {
      if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) return null

      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28)
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize)

      if (compressionMethod === 0) return Buffer.from(compressed)
      if (compressionMethod === 8) return inflateRawSync(compressed)
      return null
    }

    cursor += 46 + nameLength + extraLength + commentLength
  }

  return null
}

function extractTextFromDocx(buffer: Buffer): string | null {
  const documentXml = readZipEntry(buffer, 'word/document.xml')
  if (!documentXml) return null

  const xml = documentXml.toString('utf8')
  const text = xml
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')

  return normalizeText(decodeXmlEntities(text)) || null
}

export function extractContractText(
  input: Uint8Array | Buffer,
  fileName: string,
  mimeType?: string | null
): string | null {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
  const extension = `.${fileName.split('.').pop()?.toLowerCase() || ''}`
  const type = mimeType || ''

  if (type.startsWith('text/') || extension === '.txt') {
    return normalizeText(buffer.toString('utf8')) || null
  }

  if (type === 'application/pdf' || extension === '.pdf') {
    return extractTextFromPdf(buffer)
  }

  if (
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || extension === '.docx'
  ) {
    return extractTextFromDocx(buffer)
  }

  return null
}
