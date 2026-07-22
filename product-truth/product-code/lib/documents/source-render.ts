import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  contractSourceFormatFromFilename,
  isWordContractSource,
  type ContractSourceFormat,
} from './source-format'

const execFileAsync = promisify(execFile)

const LIBREOFFICE_CANDIDATES = process.platform === 'darwin'
  ? [
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      '/opt/homebrew/bin/soffice',
      '/usr/local/bin/soffice',
    ]
  : [
      '/usr/bin/libreoffice',
      '/usr/bin/soffice',
      '/usr/local/bin/libreoffice',
      '/usr/local/bin/soffice',
    ]

export function resolveLibreOfficePath(
  explicitPath = process.env.LIBREOFFICE_PATH,
  fileExists: (candidate: string) => boolean = existsSync
) {
  if (explicitPath?.trim()) return explicitPath.trim()
  return LIBREOFFICE_CANDIDATES.find(fileExists) || 'soffice'
}

export type SourceRenderMode = 'pdf' | 'word' | 'unsupported'

export interface RenderedPageRange {
  page: number
  start: number
  end: number
  locator: 'rendered' | 'provisional'
  line_boxes?: RenderedLineBox[]
}

export interface RenderedLineBox {
  start: number
  end: number
  text: string
  left: number
  top: number
  width: number
  height: number
}

export interface RenderedPageMap {
  page_count: number
  pages: RenderedPageRange[]
  locator: 'rendered' | 'provisional'
}

export function sourceRenderMode(filename: string | null | undefined, mimeType: string | null | undefined): SourceRenderMode {
  const format = contractSourceFormatFromFilename(filename)
  if (format === 'pdf' || (!format && mimeType === 'application/pdf')) return 'pdf'
  if (format && isWordContractSource(format)) return 'word'
  return 'unsupported'
}

export function libreOfficeSecurityProfileXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop>
    <prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>
  </item>
  <item oor:path="/org.openoffice.Office.Common/Security">
    <prop oor:name="DisableActiveContent" oor:op="fuse"><value>true</value></prop>
  </item>
</oor:items>`
}

export function wordReviewPdfExportFilter() {
  // Keep the Word page model for browser review while making existing source
  // comments visible in the margin. This PDF is a preview rendition only; the
  // downloadable Word file is produced by patching a copy of the source OOXML
  // package and never from this rendering.
  return 'pdf:writer_pdf_Export:{"ExportNotesInMargin":{"type":"boolean","value":"true"}}'
}

export async function convertWordBufferToPdf(buffer: Buffer, format: Exclude<ContractSourceFormat, 'pdf'>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ones-source-render-'))
  const profileDir = path.join(tempDir, 'libreoffice-profile')
  const inputPath = path.join(tempDir, `source.${format}`)
  const outputPath = path.join(tempDir, 'source.pdf')

  try {
    await mkdir(path.join(profileDir, 'user'), { recursive: true })
    await writeFile(path.join(profileDir, 'user', 'registrymodifications.xcu'), libreOfficeSecurityProfileXml())
    await writeFile(inputPath, buffer)
    await execFileAsync(resolveLibreOfficePath(), [
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      '--headless',
      '--nologo',
      '--nodefault',
      '--nolockcheck',
      '--norestore',
      '--nofirststartwizard',
      '--convert-to',
      wordReviewPdfExportFilter(),
      '--outdir',
      tempDir,
      inputPath,
    ], { timeout: 90_000 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        throw new Error('Word 页级渲染运行时不可用，请安装 LibreOffice 或配置 LIBREOFFICE_PATH')
      }
      throw error
    })
    return await readFile(outputPath)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

/** @deprecated Use convertWordBufferToPdf with the explicit source format. */
export async function convertDocxBufferToPdf(buffer: Buffer) {
  return convertWordBufferToPdf(buffer, 'docx')
}

function normalizeWithOffsets(input: string) {
  let normalized = ''
  const offsets: number[] = []
  for (let index = 0; index < input.length; index += 1) {
    if (/\s/u.test(input[index])) continue
    normalized += input[index]
    offsets.push(index)
  }
  return { normalized, offsets }
}

function locatePageStart(pageText: string, sourceNormalized: string, cursor: number) {
  const pageNormalized = pageText.replace(/\s+/gu, '')
  const windowLength = Math.min(48, Math.max(20, pageNormalized.length))
  for (let offset = 0; offset + windowLength <= Math.min(pageNormalized.length, 480); offset += 12) {
    const signature = pageNormalized.slice(offset, offset + windowLength)
    const found = sourceNormalized.indexOf(signature, cursor)
    if (found >= 0) return { found, pageNormalized, signatureOffset: offset }
  }
  return null
}

interface PdfLineGeometry {
  text: string
  left: number
  top: number
  width: number
  height: number
}

interface PdfWorkerInspection {
  ok: true
  page_count: number
  text: string
  pages: Array<{
    page: number
    text: string
    lines: PdfLineGeometry[]
  }>
}

const PDF_WORKER_TIMEOUT_MS = 45_000
const PDF_WORKER_MAX_BUFFER = 32 * 1024 * 1024
const PDF_INSPECTION_CACHE_TTL_MS = 5 * 60 * 1000
const PDF_INSPECTION_CACHE_MAX_ENTRIES = 4
const pdfInspectionCache = new Map<string, {
  createdAt: number
  value: Promise<PdfWorkerInspection>
}>()

function pdfWorkerScriptPath() {
  return path.join(process.cwd(), 'lib', 'documents', 'pdf-source-worker.py')
}

function parsePdfWorkerPayload(stdout: string, stderr = '') {
  const raw = stdout.trim()
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error(stderr.trim() || raw || 'PDFium 工作进程未返回有效结果')
  }
}

async function runPdfWorker(args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.env.PYTHON_PATH || 'python3',
      [pdfWorkerScriptPath(), ...args],
      { timeout: PDF_WORKER_TIMEOUT_MS, maxBuffer: PDF_WORKER_MAX_BUFFER }
    )
    const payload = parsePdfWorkerPayload(stdout, stderr)
    if (payload.ok !== true) {
      const error = payload.error && typeof payload.error === 'object'
        ? payload.error as Record<string, unknown>
        : {}
      throw new Error(typeof error.message === 'string' ? error.message : 'PDFium 工作进程执行失败')
    }
    return payload
  } catch (error) {
    const workerError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean }
    if (workerError.code === 'ENOENT') {
      throw new Error('PDFium 运行时不可用，请安装 requirements.txt 中的 Python 依赖')
    }
    if (workerError.killed || workerError.code === 'ETIMEDOUT') {
      throw new Error('PDFium 处理超过 45 秒安全上限')
    }
    if (workerError.stdout) {
      const payload = parsePdfWorkerPayload(workerError.stdout, workerError.stderr)
      const payloadError = payload.error && typeof payload.error === 'object'
        ? payload.error as Record<string, unknown>
        : {}
      if (typeof payloadError.message === 'string') throw new Error(payloadError.message)
    }
    throw error
  }
}

async function inspectPdfBufferUncached(pdfBuffer: Buffer | Uint8Array): Promise<PdfWorkerInspection> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ones-pdfium-inspect-'))
  const inputPath = path.join(tempDir, 'source.pdf')
  try {
    await writeFile(inputPath, pdfBuffer)
    return await runPdfWorker(['inspect', '--input', inputPath]) as unknown as PdfWorkerInspection
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function inspectPdfBuffer(pdfBuffer: Buffer | Uint8Array): Promise<PdfWorkerInspection> {
  const now = Date.now()
  for (const [key, cached] of pdfInspectionCache.entries()) {
    if (now - cached.createdAt >= PDF_INSPECTION_CACHE_TTL_MS) pdfInspectionCache.delete(key)
  }
  const key = createHash('sha256').update(pdfBuffer).digest('hex')
  const cached = pdfInspectionCache.get(key)
  if (cached) return cached.value

  const value = inspectPdfBufferUncached(pdfBuffer)
  pdfInspectionCache.set(key, { createdAt: now, value })
  while (pdfInspectionCache.size > PDF_INSPECTION_CACHE_MAX_ENTRIES) {
    const oldestKey = pdfInspectionCache.keys().next().value as string | undefined
    if (!oldestKey) break
    pdfInspectionCache.delete(oldestKey)
  }
  try {
    return await value
  } catch (error) {
    if (pdfInspectionCache.get(key)?.value === value) pdfInspectionCache.delete(key)
    throw error
  }
}

function decodeXmlText(value: string) {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function numericAttribute(attributes: string, name: string) {
  const match = attributes.match(new RegExp(`\\b${name}="([0-9.]+)"`, 'i'))
  return match ? Number(match[1]) : 0
}

export function parsePdfLineGeometry(html: string): PdfLineGeometry[][] {
  const pages: PdfLineGeometry[][] = []
  const pagePattern = /<page\b([^>]*)>([\s\S]*?)<\/page>/gi
  let pageMatch: RegExpExecArray | null
  while ((pageMatch = pagePattern.exec(html))) {
    const pageWidth = numericAttribute(pageMatch[1], 'width') || 1
    const pageHeight = numericAttribute(pageMatch[1], 'height') || 1
    const lines: PdfLineGeometry[] = []
    const linePattern = /<line\b([^>]*)>([\s\S]*?)<\/line>/gi
    let lineMatch: RegExpExecArray | null
    while ((lineMatch = linePattern.exec(pageMatch[2]))) {
      const words = Array.from(lineMatch[2].matchAll(/<word\b[^>]*>([\s\S]*?)<\/word>/gi))
        .map((word) => decodeXmlText(word[1]).trim())
        .filter(Boolean)
      if (words.length === 0) continue
      const xMin = numericAttribute(lineMatch[1], 'xMin')
      const yMin = numericAttribute(lineMatch[1], 'yMin')
      const xMax = numericAttribute(lineMatch[1], 'xMax')
      const yMax = numericAttribute(lineMatch[1], 'yMax')
      lines.push({
        text: words.join(' '),
        left: (xMin / pageWidth) * 100,
        top: (yMin / pageHeight) * 100,
        width: (Math.max(xMin, xMax) - xMin) / pageWidth * 100,
        height: (Math.max(yMin, yMax) - yMin) / pageHeight * 100,
      })
    }
    pages.push(lines)
  }
  return pages
}

export function attachRenderedLineBoxes(
  sourceText: string,
  pageMap: RenderedPageMap,
  geometryPages: PdfLineGeometry[][]
): RenderedPageMap {
  return {
    ...pageMap,
    pages: pageMap.pages.map((page, pageIndex) => {
      if (page.locator !== 'rendered') return page
      const pageSource = sourceText.slice(page.start, page.end + 1)
      const normalizedSource = normalizeWithOffsets(pageSource)
      let cursor = 0
      const lineBoxes = (geometryPages[pageIndex] || []).flatMap((line) => {
        const normalizedLine = line.text.replace(/\s+/gu, '')
        if (normalizedLine.length < 2) return []
        let found = normalizedSource.normalized.indexOf(normalizedLine, cursor)
        let matchedLength = normalizedLine.length
        if (found < 0) {
          const signature = normalizedLine.slice(0, Math.min(48, Math.max(12, normalizedLine.length)))
          found = normalizedSource.normalized.indexOf(signature, Math.max(0, cursor - 80))
          matchedLength = signature.length
        }
        if (found < 0) return []
        const normalizedEnd = Math.min(normalizedSource.offsets.length - 1, found + Math.max(1, matchedLength) - 1)
        const start = page.start + (normalizedSource.offsets[found] ?? 0)
        const end = page.start + (normalizedSource.offsets[normalizedEnd] ?? normalizedSource.offsets[found] ?? 0)
        cursor = Math.max(cursor, normalizedEnd + 1)
        return [{
          ...line,
          start,
          end,
        }]
      })
      return { ...page, line_boxes: lineBoxes }
    }),
  }
}

export function alignRenderedPageTexts(sourceText: string, pageTexts: string[]): RenderedPageMap {
  const source = normalizeWithOffsets(sourceText)
  const normalizedPageLengths = pageTexts.map((page) => page.replace(/\s+/gu, '').length)
  const totalRenderedCharacters = normalizedPageLengths.reduce((total, length) => total + length, 0) || 1
  let normalizedCursor = 0
  let fallbackCharacters = 0

  const pages = pageTexts.map((pageText, index) => {
    const located = locatePageStart(pageText, source.normalized, normalizedCursor)
    const fallbackStart = Math.floor((fallbackCharacters / totalRenderedCharacters) * sourceText.length)
    fallbackCharacters += normalizedPageLengths[index]
    const fallbackEnd = Math.max(fallbackStart, Math.floor((fallbackCharacters / totalRenderedCharacters) * sourceText.length) - 1)

    if (!located) {
      return {
        page: index + 1,
        start: fallbackStart,
        end: fallbackEnd,
        locator: 'provisional' as const,
      }
    }

    const normalizedStart = Math.max(0, located.found - located.signatureOffset)
    const normalizedEnd = Math.min(
      source.normalized.length - 1,
      normalizedStart + Math.max(1, located.pageNormalized.length) - 1
    )
    normalizedCursor = Math.max(located.found + located.signatureOffset + 1, normalizedEnd)
    return {
      page: index + 1,
      start: source.offsets[normalizedStart] ?? fallbackStart,
      end: source.offsets[normalizedEnd] ?? fallbackEnd,
      locator: 'rendered' as const,
    }
  })

  // Close gaps between independently aligned pages without changing their page identity.
  for (let index = 0; index < pages.length - 1; index += 1) {
    if (pages[index].locator === 'rendered' && pages[index + 1].locator === 'rendered') {
      pages[index].end = Math.max(pages[index].start, pages[index + 1].start - 1)
    }
  }
  if (pages.length > 0 && pages[pages.length - 1].locator === 'rendered') {
    pages[pages.length - 1].end = Math.max(pages[pages.length - 1].start, sourceText.length - 1)
  }

  return {
    page_count: pages.length,
    pages,
    locator: pages.every((page) => page.locator === 'rendered') ? 'rendered' : 'provisional',
  }
}

export async function extractRenderedPageMap(pdfBuffer: Buffer, sourceText: string) {
  const inspection = await inspectPdfBuffer(pdfBuffer)
  const pageMap = alignRenderedPageTexts(sourceText, inspection.pages.map((page) => page.text))
  return attachRenderedLineBoxes(sourceText, pageMap, inspection.pages.map((page) => page.lines))
}

export async function extractPdfText(pdfBuffer: Uint8Array | Buffer) {
  const inspection = await inspectPdfBuffer(pdfBuffer)
  return inspection.text
    .replace(/\f/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

export async function renderPdfPageToPng(pdfBuffer: Buffer, page: number, dpi = 144) {
  if (!Number.isInteger(page) || page < 1) throw new Error('页码必须是正整数')
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ones-source-page-'))
  const inputPath = path.join(tempDir, 'source.pdf')
  const outputPath = path.join(tempDir, 'page.png')
  try {
    await writeFile(inputPath, pdfBuffer)
    await runPdfWorker([
      'render',
      '--input', inputPath,
      '--output', outputPath,
      '--page', String(page),
      '--dpi', String(dpi),
    ])
    return await readFile(outputPath)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
