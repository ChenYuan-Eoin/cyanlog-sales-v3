export const CONTRACT_SOURCE_FORMATS = ['pdf', 'doc', 'docx', 'docm'] as const

export type ContractSourceFormat = typeof CONTRACT_SOURCE_FORMATS[number]

export const CONTRACT_SOURCE_ACCEPT = '.pdf,.doc,.docx,.docm'

const FORMAT_BY_EXTENSION: Record<string, ContractSourceFormat> = {
  '.pdf': 'pdf',
  '.doc': 'doc',
  '.docx': 'docx',
  '.docm': 'docm',
}

const MIME_BY_FORMAT: Record<ContractSourceFormat, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
}

const GENERIC_MIME_TYPES = new Set(['', 'application/octet-stream'])
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const VBA_ENTRY = Array.from('vbaProject.bin', (character) => character.charCodeAt(0))

function startsWithBytes(bytes: Uint8Array, expected: number[]) {
  return bytes.length >= expected.length && expected.every((value, index) => bytes[index] === value)
}

function includesBytes(bytes: Uint8Array, expected: number[]) {
  for (let start = 0; start <= bytes.length - expected.length; start += 1) {
    if (expected.every((value, index) => bytes[start + index] === value)) return true
  }
  return false
}

function extensionOf(filename: string | null | undefined) {
  const match = (filename || '').trim().toLowerCase().match(/\.[^.]+$/)
  return match?.[0] || ''
}

export function contractSourceFormatFromFilename(filename: string | null | undefined) {
  return FORMAT_BY_EXTENSION[extensionOf(filename)] || null
}

export function canonicalContractSourceMime(format: ContractSourceFormat) {
  return MIME_BY_FORMAT[format]
}

export function isWordContractSource(format: ContractSourceFormat): format is 'doc' | 'docx' | 'docm' {
  return format !== 'pdf'
}

export interface ContractSourceInspection {
  ok: boolean
  format: ContractSourceFormat | null
  mimeType: string | null
  error?: string
}

export function inspectContractSource(
  filename: string | null | undefined,
  mimeType: string | null | undefined,
  bytes?: Uint8Array
): ContractSourceInspection {
  const format = contractSourceFormatFromFilename(filename)
  if (!format) {
    return { ok: false, format: null, mimeType: null, error: '仅支持 PDF、DOC、DOCX、DOCM 文件' }
  }

  // Media types are case-insensitive. Browsers differ on the casing of the
  // DOCM `macroEnabled` subtype, so compare normalized tokens while returning
  // one canonical value to Storage and the database.
  const normalizedMime = (mimeType || '').split(';', 1)[0].trim().toLowerCase()
  const canonicalMime = canonicalContractSourceMime(format)
  if (!GENERIC_MIME_TYPES.has(normalizedMime) && normalizedMime !== canonicalMime.toLowerCase()) {
    return {
      ok: false,
      format,
      mimeType: canonicalMime,
      error: `文件扩展名与类型不一致：.${format} 应为 ${canonicalMime}`,
    }
  }

  if (bytes && bytes.length > 0) {
    const validSignature = format === 'pdf'
      ? startsWithBytes(bytes, PDF_MAGIC)
      : format === 'doc'
        ? startsWithBytes(bytes, OLE_MAGIC)
        : bytes[0] === 0x50 && bytes[1] === 0x4b
    if (!validSignature) {
      return { ok: false, format, mimeType: canonicalMime, error: `文件内容不是有效的 ${format.toUpperCase()} 格式` }
    }

    // OOXML central-directory entry names are stored in clear text. A DOCX
    // carrying a VBA project must not enter the macro-free DOCX path.
    if (format === 'docx' && includesBytes(bytes, VBA_ENTRY)) {
      return { ok: false, format, mimeType: canonicalMime, error: '检测到宏内容，请使用 .docm 扩展名上传' }
    }
  }

  return { ok: true, format, mimeType: canonicalMime }
}
