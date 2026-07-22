import { Buffer } from 'node:buffer'
import JSZip from 'jszip'

const CONTENT_TYPES_PATH = '[Content_Types].xml'
const ROOT_RELS_PATH = '_rels/.rels'
const DOCUMENT_XML_PATH = 'word/document.xml'
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024
const MAX_METADATA_XML_BYTES = 1024 * 1024
const MAX_PACKAGE_ENTRIES = 4096

const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const OFFICE_DOCUMENT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'
const DOCX_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
const DOCM_MAIN = 'application/vnd.ms-word.document.macroEnabled.main+xml'

export const MAX_DOCUMENT_XML_BYTES = 16 * 1024 * 1024
export const MAX_DOCUMENT_XML_DEPTH = 128
export const MAX_DOCUMENT_XML_ELEMENTS = 100_000
export const MAX_EXTRACTED_TEXT_CHARS = 2_000_000

export type ExpectedWordFormat = 'docx' | 'docm'

export type WordSourceTextErrorCode =
  | 'INVALID_PACKAGE'
  | 'AMBIGUOUS_PACKAGE'
  | 'MISSING_PACKAGE_PART'
  | 'MISSING_DOCUMENT_XML'
  | 'DOCUMENT_FORMAT_MISMATCH'
  | 'DOCUMENT_XML_TOO_LARGE'
  | 'DOCUMENT_XML_TOO_COMPLEX'
  | 'DOCUMENT_TEXT_TOO_LARGE'
  | 'INVALID_DOCUMENT_XML'
  | 'EMPTY_DOCUMENT_TEXT'

export class WordSourceTextError extends Error {
  constructor(public readonly code: WordSourceTextErrorCode, message: string) {
    super(message)
    this.name = 'WordSourceTextError'
  }
}

function fail(code: WordSourceTextErrorCode, message: string): never {
  throw new WordSourceTextError(code, message)
}

function inspectCentralDirectory(bytes: Uint8Array) {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let index = data.length - 22; index >= Math.max(0, data.length - 65_557); index -= 1) {
    if (data.readUInt32LE(index) === 0x06054b50 && index + 22 + data.readUInt16LE(index + 20) === data.length) {
      eocd = index
      break
    }
  }
  if (eocd < 0) fail('INVALID_PACKAGE', 'Word 文件缺少有效 ZIP 中央目录')
  const entriesOnDisk = data.readUInt16LE(eocd + 8)
  const entryCount = data.readUInt16LE(eocd + 10)
  const directorySize = data.readUInt32LE(eocd + 12)
  const directoryOffset = data.readUInt32LE(eocd + 16)
  if (
    data.readUInt16LE(eocd + 4) !== 0 || data.readUInt16LE(eocd + 6) !== 0
    || entriesOnDisk !== entryCount || entryCount > MAX_PACKAGE_ENTRIES
    || entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff
    || directoryOffset + directorySize !== eocd
  ) fail('INVALID_PACKAGE', 'Word 文件 ZIP 中央目录结构无效')

  const names = new Set<string>()
  const equivalentNames = new Set<string>()
  let cursor = directoryOffset
  for (let count = 0; count < entryCount; count += 1) {
    if (cursor + 46 > eocd || data.readUInt32LE(cursor) !== 0x02014b50) {
      fail('INVALID_PACKAGE', 'Word 文件 ZIP 中央目录条目无效')
    }
    const flags = data.readUInt16LE(cursor + 8)
    const method = data.readUInt16LE(cursor + 10)
    const nameLength = data.readUInt16LE(cursor + 28)
    const extraLength = data.readUInt16LE(cursor + 30)
    const commentLength = data.readUInt16LE(cursor + 32)
    const end = cursor + 46 + nameLength + extraLength + commentLength
    if ((flags & 1) !== 0 || ![0, 8].includes(method) || end > eocd || nameLength === 0) {
      fail('INVALID_PACKAGE', 'Word 文件包含不受支持的 ZIP 条目')
    }
    const rawName = data.subarray(cursor + 46, cursor + 46 + nameLength)
    let name: string
    try {
      name = new TextDecoder((flags & 0x800) !== 0 ? 'utf-8' : 'latin1', { fatal: true }).decode(rawName)
    } catch {
      fail('AMBIGUOUS_PACKAGE', 'Word 文件包含无法确定的部件路径')
    }
    const partName = name.endsWith('/') ? name.slice(0, -1) : name
    const segments = partName.split('/')
    if (
      !partName || name.startsWith('/') || name.includes('\\') || name.includes('\0')
      || partName.normalize('NFC') !== partName
      || segments.some((segment) => !segment || segment === '.' || segment === '..')
    ) fail('AMBIGUOUS_PACKAGE', 'Word 文件包含非规范或有歧义的部件路径')
    const equivalent = partName.normalize('NFC').toLocaleLowerCase('en-US')
    if (equivalentNames.has(equivalent)) fail('AMBIGUOUS_PACKAGE', 'Word 文件包含重复或大小写等价的部件路径')
    equivalentNames.add(equivalent)
    names.add(name)
    cursor = end
  }
  if (cursor !== eocd) fail('INVALID_PACKAGE', 'Word 文件 ZIP 中央目录长度无效')
  return names
}

function declaredUncompressedSize(entry: JSZip.JSZipObject) {
  const data = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data
  return typeof data?.uncompressedSize === 'number' ? data.uncompressedSize : null
}

async function readEntryBounded(entry: JSZip.JSZipObject, limit: number, code: WordSourceTextErrorCode, message: string) {
  const declaredSize = declaredUncompressedSize(entry)
  if (declaredSize !== null && (!Number.isSafeInteger(declaredSize) || declaredSize > limit)) fail(code, message)
  return new Promise<Buffer>((resolve, reject) => {
    const stream = entry.nodeStream('nodebuffer')
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      stream.pause()
      reject(error)
    }
    stream.on('data', (value: Buffer | Uint8Array) => {
      if (settled) return
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      total += chunk.byteLength
      if (total > limit) return rejectOnce(new WordSourceTextError(code, message))
      chunks.push(chunk)
    })
    stream.on('error', (error) => rejectOnce(error instanceof Error ? error : new Error(String(error))))
    stream.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks, total))
    })
  })
}

function decodeXmlBytes(bytes: Uint8Array, code: WordSourceTextErrorCode, message: string) {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2))
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2))
    const offset = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset))
  } catch {
    fail(code, message)
  }
}

function decodeXmlEntities(value: string) {
  let result = ''
  let cursor = 0
  while (cursor < value.length) {
    const ampersand = value.indexOf('&', cursor)
    if (ampersand < 0) return result + value.slice(cursor)
    result += value.slice(cursor, ampersand)
    const semicolon = value.indexOf(';', ampersand + 1)
    if (semicolon < 0 || semicolon - ampersand > 16) fail('INVALID_DOCUMENT_XML', 'Word XML 包含无效实体')
    const entity = value.slice(ampersand + 1, semicolon)
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (entity in named) result += named[entity]
    else {
      const match = entity.match(/^#(?:x([0-9a-f]+)|(\d+))$/i)
      const codePoint = match ? Number.parseInt(match[1] || match[2], match[1] ? 16 : 10) : Number.NaN
      if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        fail('INVALID_DOCUMENT_XML', 'Word XML 包含无效实体')
      }
      result += String.fromCodePoint(codePoint)
    }
    cursor = semicolon + 1
  }
  return result
}

type XmlElement = { name: string; localName: string; namespaceUri: string; depth: number; attributes: Map<string, string> }

function tagEnd(xml: string, start: number) {
  let quote = ''
  for (let index = start + 1; index < xml.length; index += 1) {
    const character = xml[index]
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") quote = character
    else if (character === '>') return index
  }
  fail('INVALID_DOCUMENT_XML', 'Word XML 标签未闭合')
}

function parseTag(raw: string) {
  const nameMatch = raw.match(/^([A-Za-z_][A-Za-z0-9_.:-]*)/)
  if (!nameMatch) fail('INVALID_DOCUMENT_XML', 'Word XML 标签无效')
  const attributes = new Map<string, string>()
  let cursor = nameMatch[0].length
  while (cursor < raw.length) {
    while (/\s/.test(raw[cursor] || '')) cursor += 1
    if (cursor >= raw.length) break
    const match = raw.slice(cursor).match(/^([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(["'])/)
    if (!match) fail('INVALID_DOCUMENT_XML', 'Word XML 属性无效')
    const name = match[1]
    const quote = match[2]
    cursor += match[0].length
    const end = raw.indexOf(quote, cursor)
    if (end < 0 || attributes.has(name)) fail('INVALID_DOCUMENT_XML', 'Word XML 属性重复或未闭合')
    attributes.set(name, decodeXmlEntities(raw.slice(cursor, end)))
    cursor = end + 1
  }
  return { name: nameMatch[1], attributes }
}

function walkXml(xml: string, handlers: {
  start?: (element: XmlElement) => void
  text?: (value: string) => void
  end?: (element: XmlElement) => void
}) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) fail('INVALID_DOCUMENT_XML', 'Word XML 包含无效控制字符')
  const stack: Array<XmlElement & { namespaces: Map<string, string> }> = []
  let cursor = 0
  let rootCount = 0
  let elementCount = 0
  while (cursor < xml.length) {
    if (xml[cursor] !== '<') {
      const end = xml.indexOf('<', cursor)
      const value = xml.slice(cursor, end < 0 ? xml.length : end)
      if (stack.length) handlers.text?.(decodeXmlEntities(value))
      else if (value.trim()) fail('INVALID_DOCUMENT_XML', 'Word XML 根元素之外包含文本')
      cursor = end < 0 ? xml.length : end
      continue
    }
    if (xml.startsWith('<!--', cursor)) {
      const end = xml.indexOf('-->', cursor + 4)
      if (end < 0) fail('INVALID_DOCUMENT_XML', 'Word XML 注释未闭合')
      cursor = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', cursor)) {
      const end = xml.indexOf(']]>', cursor + 9)
      if (end < 0 || !stack.length) fail('INVALID_DOCUMENT_XML', 'Word XML CDATA 无效')
      handlers.text?.(xml.slice(cursor + 9, end))
      cursor = end + 3
      continue
    }
    if (xml.startsWith('<?', cursor)) {
      const end = xml.indexOf('?>', cursor + 2)
      if (end < 0) fail('INVALID_DOCUMENT_XML', 'Word XML 声明未闭合')
      cursor = end + 2
      continue
    }
    if (xml.startsWith('<!', cursor)) fail('INVALID_DOCUMENT_XML', 'Word XML 不允许 DTD 或实体声明')
    const end = tagEnd(xml, cursor)
    let raw = xml.slice(cursor + 1, end).trim()
    const closing = raw.startsWith('/')
    if (closing) raw = raw.slice(1).trim()
    const selfClosing = !closing && raw.endsWith('/')
    if (selfClosing) raw = raw.slice(0, -1).trim()
    if (closing) {
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(raw)) fail('INVALID_DOCUMENT_XML', 'Word XML 闭合标签无效')
      const opened = stack.pop()
      if (!opened || opened.name !== raw) fail('INVALID_DOCUMENT_XML', 'Word XML 标签不匹配')
      handlers.end?.(opened)
    } else {
      const parsed = parseTag(raw)
      elementCount += 1
      const depth = stack.length + 1
      if (depth > MAX_DOCUMENT_XML_DEPTH || elementCount > MAX_DOCUMENT_XML_ELEMENTS) {
        fail('DOCUMENT_XML_TOO_COMPLEX', 'Word 正文 XML 结构超出安全上限')
      }
      const namespaces = new Map(stack.at(-1)?.namespaces || [['xml', 'http://www.w3.org/XML/1998/namespace']])
      for (const [name, value] of parsed.attributes) {
        if (name === 'xmlns') namespaces.set('', value)
        else if (name.startsWith('xmlns:')) namespaces.set(name.slice(6), value)
      }
      const colon = parsed.name.indexOf(':')
      const prefix = colon < 0 ? '' : parsed.name.slice(0, colon)
      const localName = colon < 0 ? parsed.name : parsed.name.slice(colon + 1)
      const namespaceUri = namespaces.get(prefix)
      if (namespaceUri === undefined) fail('INVALID_DOCUMENT_XML', 'Word XML 使用未声明命名空间')
      if (depth === 1) rootCount += 1
      const element = { name: parsed.name, localName, namespaceUri, depth, attributes: parsed.attributes, namespaces }
      handlers.start?.(element)
      if (selfClosing) handlers.end?.(element)
      else stack.push(element)
    }
    cursor = end + 1
  }
  if (stack.length || rootCount !== 1) fail('INVALID_DOCUMENT_XML', 'Word XML 结构不完整')
}

function validateContentTypes(xml: string, expectedFormat?: ExpectedWordFormat) {
  let rootValid = false
  const mainOverrides: string[] = []
  const overrideNames = new Set<string>()
  walkXml(xml, { start(element) {
    if (element.depth === 1) rootValid = element.namespaceUri === CONTENT_TYPES_NS && element.localName === 'Types'
    if (element.depth !== 2 || element.namespaceUri !== CONTENT_TYPES_NS || element.localName !== 'Override') return
    const partName = element.attributes.get('PartName') || ''
    const contentType = element.attributes.get('ContentType') || ''
    const key = partName.normalize('NFC').toLocaleLowerCase('en-US')
    if (!partName.startsWith('/') || partName.includes('\\') || partName.split('/').slice(1).some((part) => !part || part === '.' || part === '..') || overrideNames.has(key)) {
      fail('AMBIGUOUS_PACKAGE', 'Word Content Types 包含重复或歧义部件声明')
    }
    overrideNames.add(key)
    if (key === '/word/document.xml') {
      if (partName !== '/word/document.xml') fail('AMBIGUOUS_PACKAGE', 'Word 主文档 Content Type 路径大小写不唯一')
      mainOverrides.push(contentType)
    }
  } })
  if (!rootValid || mainOverrides.length !== 1) fail('INVALID_PACKAGE', 'Word 主文档 Content Type 声明无效')
  const expected = expectedFormat === 'docx' ? DOCX_MAIN : expectedFormat === 'docm' ? DOCM_MAIN : null
  if ((expected && mainOverrides[0] !== expected) || (!expected && ![DOCX_MAIN, DOCM_MAIN].includes(mainOverrides[0]))) {
    fail('DOCUMENT_FORMAT_MISMATCH', 'Word 文件扩展格式与主文档 Content Type 不一致')
  }
}

function validateRootRelationships(xml: string) {
  let rootValid = false
  const ids = new Set<string>()
  const officeDocuments: Array<{ target: string; mode: string }> = []
  walkXml(xml, { start(element) {
    if (element.depth === 1) rootValid = element.namespaceUri === RELATIONSHIPS_NS && element.localName === 'Relationships'
    if (element.depth !== 2 || element.namespaceUri !== RELATIONSHIPS_NS || element.localName !== 'Relationship') return
    const id = element.attributes.get('Id') || ''
    if (!id || ids.has(id)) fail('INVALID_PACKAGE', 'Word package root relationship Id 无效或重复')
    ids.add(id)
    if (element.attributes.get('Type') === OFFICE_DOCUMENT_REL) {
      officeDocuments.push({ target: element.attributes.get('Target') || '', mode: element.attributes.get('TargetMode') || 'Internal' })
    }
  } })
  if (!rootValid || officeDocuments.length !== 1) fail('INVALID_PACKAGE', 'Word package root 必须唯一关联主文档')
  const relation = officeDocuments[0]
  const target = relation.target.startsWith('/') ? relation.target.slice(1) : relation.target
  if (relation.mode !== 'Internal' || target !== DOCUMENT_XML_PATH) {
    fail('INVALID_PACKAGE', 'Word package root 未以内部关系指向 word/document.xml')
  }
}

function extractDocumentXmlText(xml: string) {
  const output: string[] = []
  let outputLength = 0
  let bodyDepth = 0
  let excludedDepth = 0
  let textDepth = 0
  let bodySeen = false
  let rootValid = false
  const append = (value: string) => {
    outputLength += value.length
    if (outputLength > MAX_EXTRACTED_TEXT_CHARS) fail('DOCUMENT_TEXT_TOO_LARGE', 'Word 正文文本超出安全上限')
    output.push(value)
  }
  walkXml(xml, {
    start(element) {
      if (element.depth === 1) rootValid = element.namespaceUri === WORD_NS && element.localName === 'document'
      if (element.namespaceUri !== WORD_NS) return
      if (element.localName === 'body') {
        if (element.depth !== 2 || bodySeen) fail('INVALID_DOCUMENT_XML', 'Word 正文必须是主文档的唯一直接子元素')
        bodyDepth += 1
        bodySeen = true
      }
      if (element.localName === 'del' || element.localName === 'moveFrom') excludedDepth += 1
      if (element.localName === 't') textDepth += 1
      if (bodyDepth > 0 && excludedDepth === 0) {
        if (element.localName === 'tab') append('\t')
        if (element.localName === 'br' || element.localName === 'cr') append('\n')
      }
    },
    text(value) {
      if (bodyDepth > 0 && excludedDepth === 0 && textDepth > 0) append(value)
    },
    end(element) {
      if (element.namespaceUri !== WORD_NS) return
      if (element.localName === 'p' && bodyDepth > 0 && excludedDepth === 0) append('\n')
      if (element.localName === 't') textDepth -= 1
      if (element.localName === 'del' || element.localName === 'moveFrom') excludedDepth -= 1
      if (element.localName === 'body') bodyDepth -= 1
    },
  })
  if (!rootValid || !bodySeen || bodyDepth || excludedDepth || textDepth) fail('INVALID_DOCUMENT_XML', 'word/document.xml 根元素或正文结构无效')
  const text = output.join('').replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '')
  if (!text.trim()) fail('EMPTY_DOCUMENT_TEXT', 'Word 正文为空')
  return text
}

/** Extract current DOCX/DOCM body text after a minimal OPC identity check. */
export async function extractCurrentWordText(source: Uint8Array | ArrayBuffer, expectedFormat?: ExpectedWordFormat) {
  if (typeof window !== 'undefined') fail('INVALID_PACKAGE', 'Word 文本提取仅允许在服务端运行')
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source)
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PACKAGE_BYTES) fail('INVALID_PACKAGE', 'Word 文件大小无效')
  const centralNames = inspectCentralDirectory(bytes)
  const missing = [CONTENT_TYPES_PATH, ROOT_RELS_PATH, DOCUMENT_XML_PATH].filter((path) => !centralNames.has(path))
  if (missing.includes(DOCUMENT_XML_PATH)) fail('MISSING_DOCUMENT_XML', 'Word 文件缺少 word/document.xml')
  if (missing.length) fail('MISSING_PACKAGE_PART', `Word 文件缺少必需 OPC 部件：${missing.join(', ')}`)

  let zip: JSZip
  try { zip = await JSZip.loadAsync(bytes, { createFolders: false }) }
  catch { fail('INVALID_PACKAGE', 'Word 文件不是有效的 OOXML 包') }
  const contentTypes = zip.file(CONTENT_TYPES_PATH)
  const relationships = zip.file(ROOT_RELS_PATH)
  const document = zip.file(DOCUMENT_XML_PATH)
  if (!contentTypes || contentTypes.dir || !relationships || relationships.dir || !document || document.dir) {
    fail('INVALID_PACKAGE', 'Word 文件必需 OPC 部件不可读取')
  }
  try {
    validateContentTypes(decodeXmlBytes(await readEntryBounded(contentTypes, MAX_METADATA_XML_BYTES, 'INVALID_PACKAGE', 'Word Content Types 超出安全上限'), 'INVALID_PACKAGE', 'Word Content Types 编码无效'), expectedFormat)
    validateRootRelationships(decodeXmlBytes(await readEntryBounded(relationships, MAX_METADATA_XML_BYTES, 'INVALID_PACKAGE', 'Word package root relationships 超出安全上限'), 'INVALID_PACKAGE', 'Word package root relationships 编码无效'))
    const documentBytes = await readEntryBounded(document, MAX_DOCUMENT_XML_BYTES, 'DOCUMENT_XML_TOO_LARGE', 'Word 正文 XML 超出安全上限')
    return extractDocumentXmlText(decodeXmlBytes(documentBytes, 'INVALID_DOCUMENT_XML', 'Word 正文 XML 编码无效'))
  } catch (error) {
    if (error instanceof WordSourceTextError) throw error
    fail('INVALID_PACKAGE', 'Word OPC 部件无法解压或验证')
  }
}
