// REQ:F007
// PURPOSE: Word document export with native Word comments in Node.js

import path from 'path'
import fs from 'fs'
import os from 'os'
import JSZip from 'jszip'

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
  mode?: 'source_comments' | 'report_fallback'
  error?: string
}

type NormalizedComment = {
  body: string
  selectedText: string
  level: string
  startOffset: number | null
  endOffset: number | null
  manualLocationRequired: boolean
}

type GenerateWordDocumentOptions = {
  allowReportFallback?: boolean
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const COMMENTS_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
const COMMENTS_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
const AUTHOR = 'ONES 业务运营'
const INITIALS = 'OB'

function safeText(value: unknown) {
  return value === null || value === undefined ? '' : String(value)
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function decodeXmlText(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function paragraphText(paragraphXml: string) {
  return decodeXmlText(paragraphXml.replace(/<[^>]+>/g, ''))
}

function normalizeComments(data: ExportData | ExportComment[]): NormalizedComment[] {
  const payload: ExportData = Array.isArray(data)
    ? { risks: data, clauses: [], annotations: [] }
    : { ...data, clauses: data.clauses || [], annotations: data.annotations || [] }

  const annotationComments = (payload.annotations || [])
    .filter((annotation) => !annotation.status || annotation.status === 'open')
    .map((annotation) => ({
      body: safeText(annotation.comment),
      selectedText: safeText(annotation.selected_text),
      level: safeText(annotation.priority || 'high'),
      startOffset: typeof annotation.start_offset === 'number' ? annotation.start_offset : null,
      endOffset: typeof annotation.end_offset === 'number' ? annotation.end_offset : null,
      manualLocationRequired: safeText(annotation.comment).includes('LocationStatus: manual_required')
        || !safeText(annotation.selected_text).trim(),
    }))
    .filter((comment) => comment.body.trim())

  if (annotationComments.length > 0) return annotationComments

  return (payload.risks || [])
    .map((risk) => {
      const title = safeText(risk.title || '风险项')
      const description = safeText(risk.description)
      const suggestion = safeText(risk.suggestion)
      const level = safeText(risk.level || 'yellow')
      const bodyLines = [`【${level}】${title}`]
      if (description) bodyLines.push(`问题：${description}`)
      if (suggestion) bodyLines.push(`建议：${suggestion}`)
      return {
        body: bodyLines.join('\n'),
        selectedText: title,
        level,
        startOffset: null,
        endOffset: null,
        manualLocationRequired: false,
      }
    })
    .filter((comment) => comment.body.trim())
}

function createCommentXml(id: number, body: string) {
  const paragraphs = (body.split(/\r?\n/) || ['']).map((line) => (
    `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
  )).join('')

  return [
    `<w:comment w:id="${id}" w:author="${escapeXml(AUTHOR)}" w:initials="${INITIALS}" w:date="${new Date().toISOString()}">`,
    paragraphs,
    '</w:comment>',
  ].join('')
}

function maxCommentId(commentsXml: string) {
  let maxId = -1
  for (const match of commentsXml.matchAll(/<w:comment\b[^>]*\bw:id="(\d+)"/g)) {
    maxId = Math.max(maxId, Number(match[1]))
  }
  return maxId
}

function appendCommentsXml(existingXml: string | null, comments: NormalizedComment[], firstId: number) {
  const commentNodes = comments
    .map((comment, index) => createCommentXml(firstId + index, comment.body))
    .join('')

  if (existingXml && existingXml.includes('</w:comments>')) {
    return existingXml.replace('</w:comments>', `${commentNodes}</w:comments>`)
  }

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:comments xmlns:w="${W_NS}">`,
    commentNodes,
    '</w:comments>',
  ].join('')
}

function injectCommentReference(paragraphXml: string, commentId: number) {
  const withStart = paragraphXml.replace(
    /<w:p\b[^>]*>/,
    (openTag) => `${openTag}<w:commentRangeStart w:id="${commentId}"/>`
  )
  return withStart.replace(
    '</w:p>',
    `<w:commentRangeEnd w:id="${commentId}"/><w:r><w:commentReference w:id="${commentId}"/></w:r></w:p>`
  )
}

function occurrenceIndexes(value: string, search: string) {
  if (!search) return []
  const indexes: number[] = []
  let fromIndex = 0
  while (fromIndex < value.length) {
    const index = value.indexOf(search, fromIndex)
    if (index < 0) break
    indexes.push(index)
    fromIndex = index + Math.max(search.length, 1)
  }
  return indexes
}

function injectCommentReferenceAtText(
  paragraphXml: string,
  selectedText: string,
  commentId: number,
  occurrenceIndex = 0
) {
  const runMatches = Array.from(paragraphXml.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g))
  let remainingOccurrence = occurrenceIndex

  for (const runMatch of runMatches) {
    const runXml = runMatch[0]
    const textMatch = runXml.match(/<w:t([^>]*)>([\s\S]*?)<\/w:t>/)
    if (!textMatch) continue

    const [, attrs, rawText] = textMatch
    const decoded = decodeXmlText(rawText)
    let selectedIndex = -1
    let searchFrom = 0
    while (searchFrom < decoded.length) {
      const currentIndex = decoded.indexOf(selectedText, searchFrom)
      if (currentIndex < 0) break
      if (remainingOccurrence === 0) {
        selectedIndex = currentIndex
        break
      }
      remainingOccurrence -= 1
      searchFrom = currentIndex + Math.max(selectedText.length, 1)
    }
    if (selectedIndex < 0) continue

    const before = decoded.slice(0, selectedIndex)
    const selected = decoded.slice(selectedIndex, selectedIndex + selectedText.length)
    const after = decoded.slice(selectedIndex + selectedText.length)
    const makeRun = (value: string) => (
      value
        ? runXml.replace(textMatch[0], `<w:t${attrs}>${escapeXml(value)}</w:t>`)
        : ''
    )

    const replacement = [
      makeRun(before),
      `<w:commentRangeStart w:id="${commentId}"/>`,
      makeRun(selected),
      `<w:commentRangeEnd w:id="${commentId}"/>`,
      `<w:r><w:commentReference w:id="${commentId}"/></w:r>`,
      makeRun(after),
    ].join('')

    const runIndex = runMatch.index ?? -1
    if (runIndex < 0) break
    return {
      xml: [
        paragraphXml.slice(0, runIndex),
        replacement,
        paragraphXml.slice(runIndex + runXml.length),
      ].join(''),
      mode: 'selected_text' as const,
    }
  }

  return {
    xml: injectCommentReference(paragraphXml, commentId),
    mode: 'paragraph' as const,
  }
}

function addCommentAnchors(documentXml: string, comments: NormalizedComment[], firstId: number) {
  const paragraphMatches = Array.from(documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g))
  let textCursor = 0
  const textParagraphs = paragraphMatches
    .map((match, index) => {
      const text = paragraphText(match[0])
      const paragraph = {
        index,
        text,
        startOffset: textCursor,
        endOffset: textCursor + text.length,
      }
      textCursor += text.length + 1
      return paragraph
    })
    .filter((paragraph) => paragraph.text.trim())

  if (textParagraphs.length === 0) {
    throw new Error('input docx has no text paragraphs')
  }

  const updatedParagraphs = paragraphMatches.map((match) => match[0])

  comments.forEach((comment, index) => {
    const selectedText = comment.selectedText.trim()
    if (comment.manualLocationRequired || !selectedText) {
      throw new Error(`批注「${comment.body.split('\n')[0]}」缺少可写入 Word 的原文定位，需人工定位`)
    }

    const candidates = textParagraphs.filter((paragraph) => (
      paragraph.text.includes(selectedText)
    ))
    if (candidates.length === 0) {
      throw new Error(`批注「${comment.body.split('\n')[0]}」未在源文件中找到证据原文：${selectedText}`)
    }

    const hasSourceRange = typeof comment.startOffset === 'number'
      && typeof comment.endOffset === 'number'
      && comment.endOffset > comment.startOffset
    let target = candidates[0]
    let occurrenceIndex = 0

    if (hasSourceRange) {
      const rangedCandidates = candidates.filter((paragraph) => (
        comment.startOffset! >= paragraph.startOffset && comment.endOffset! <= paragraph.endOffset
      ))
      if (rangedCandidates.length !== 1) {
        throw new Error(`批注「${comment.body.split('\n')[0]}」证据原文与 source range 不匹配，需人工定位：${selectedText}`)
      }
      target = rangedCandidates[0]
      const indexes = occurrenceIndexes(target.text, selectedText)
      const relativeStart = comment.startOffset! - target.startOffset
      const exactOccurrence = indexes.indexOf(relativeStart)
      if (exactOccurrence >= 0) {
        occurrenceIndex = exactOccurrence
      } else if (indexes.length === 1) {
        occurrenceIndex = 0
      } else {
        throw new Error(`批注「${comment.body.split('\n')[0]}」证据原文在同一段内不唯一，需人工定位：${selectedText}`)
      }
    } else {
      if (candidates.length > 1) {
        throw new Error(`批注「${comment.body.split('\n')[0]}」证据原文不唯一，需人工定位：${selectedText}`)
      }
      const indexes = occurrenceIndexes(target.text, selectedText)
      if (indexes.length > 1) {
        throw new Error(`批注「${comment.body.split('\n')[0]}」证据原文在同一段内不唯一，需人工定位：${selectedText}`)
      }
    }

    const injected = injectCommentReferenceAtText(
      updatedParagraphs[target.index],
      selectedText,
      firstId + index,
      occurrenceIndex
    )
    if (injected.mode === 'paragraph' && occurrenceIndexes(target.text, selectedText).length > 1) {
      throw new Error(`批注「${comment.body.split('\n')[0]}」无法精确锚定重复证据原文，需人工定位：${selectedText}`)
    }
    updatedParagraphs[target.index] = injected.xml
  })

  let output = ''
  let lastIndex = 0
  paragraphMatches.forEach((match, index) => {
    const matchIndex = match.index ?? 0
    output += documentXml.slice(lastIndex, matchIndex)
    output += updatedParagraphs[index]
    lastIndex = matchIndex + match[0].length
  })
  output += documentXml.slice(lastIndex)
  return output
}

async function ensureCommentsRelationship(zip: JSZip) {
  const relsPath = 'word/_rels/document.xml.rels'
  const existing = await zip.file(relsPath)?.async('string')
  const relsXml = existing || `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL_NS}"></Relationships>`
  if (relsXml.includes(COMMENTS_REL_TYPE)) return relsXml

  const existingIds = new Set(Array.from(relsXml.matchAll(/\bId="([^"]+)"/g)).map((match) => match[1]))
  let relId = 'rIdComments'
  let counter = 1
  while (existingIds.has(relId)) {
    relId = `rIdComments${counter}`
    counter += 1
  }

  const relationship = `<Relationship Id="${relId}" Type="${COMMENTS_REL_TYPE}" Target="comments.xml"/>`
  if (relsXml.includes('</Relationships>')) {
    return relsXml.replace('</Relationships>', `${relationship}</Relationships>`)
  }

  return relsXml.replace(/<Relationships([^>]*)\/>/, `<Relationships$1>${relationship}</Relationships>`)
}

async function ensureCommentsContentType(zip: JSZip) {
  const contentPath = '[Content_Types].xml'
  const contentTypesXml = await zip.file(contentPath)?.async('string')
  if (!contentTypesXml) {
    throw new Error('input docx missing [Content_Types].xml')
  }
  if (contentTypesXml.includes('PartName="/word/comments.xml"')) return contentTypesXml

  const override = `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CONTENT_TYPE}"/>`
  return contentTypesXml.replace('</Types>', `${override}</Types>`)
}

async function addNativeComments(inputPath: string, outputPath: string, comments: NormalizedComment[]) {
  const inputBuffer = fs.readFileSync(inputPath)
  const zip = await JSZip.loadAsync(inputBuffer)
  const documentFile = zip.file('word/document.xml')
  if (!documentFile || !zip.file('[Content_Types].xml')) {
    throw new Error('input file is not a writable docx')
  }

  const documentXml = await documentFile.async('string')
  const existingCommentsXml = await zip.file('word/comments.xml')?.async('string') || null
  const firstCommentId = maxCommentId(existingCommentsXml || '') + 1

  zip.file('word/document.xml', addCommentAnchors(documentXml, comments, firstCommentId))
  zip.file('word/comments.xml', appendCommentsXml(existingCommentsXml, comments, firstCommentId))
  zip.file('word/_rels/document.xml.rels', await ensureCommentsRelationship(zip))
  zip.file('[Content_Types].xml', await ensureCommentsContentType(zip))

  const outputBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  })
  fs.writeFileSync(outputPath, outputBuffer)
}

function paragraph(line: string) {
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
}

async function createReportDocx(outputPath: string, data: ExportData | ExportComment[], comments: NormalizedComment[], note: string) {
  const payload = Array.isArray(data) ? { risks: data } : data
  const lines = [
    'ONES 业务运营合同审核批注报告',
    note,
    `生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
  ]

  if (!Array.isArray(payload)) {
    if (payload.summary) lines.push('', '审核摘要', payload.summary)
    if (payload.effectiveness_analysis) lines.push('', '效力与风险分析', payload.effectiveness_analysis)
  }

  lines.push('', '风险批注')
  comments.forEach((comment, index) => {
    lines.push(`${index + 1}. ${comment.body}`)
  })

  const zip = new JSZip()
  zip.file('[Content_Types].xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Types xmlns="${CT_NS}">`,
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '</Types>',
  ].join(''))
  zip.file('_rels/.rels', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Relationships xmlns="${REL_NS}">`,
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '</Relationships>',
  ].join(''))
  zip.file('word/document.xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>`,
    ...lines.map(paragraph),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
    '</w:body></w:document>',
  ].join(''))
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL_NS}"/>`)

  const outputBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  })
  fs.writeFileSync(outputPath, outputBuffer)
}

/**
 * Generate a Word-native commented copy from the uploaded source docx.
 */
export async function generateWordDocument(
  inputDocxPath: string,
  data: ExportData | ExportComment[],
  options: GenerateWordDocumentOptions = {}
): Promise<WordExportResult> {
  try {
    const tempDir = os.tmpdir()
    const outputPath = path.join(tempDir, `contract-export-${Date.now()}.docx`)
    const comments = normalizeComments(data)
    if (comments.length === 0) {
      return {
        success: false,
        error: '没有可导出的风险批注',
      }
    }

    const actualInputPath = fs.existsSync(inputDocxPath) ? inputDocxPath : ''
    if (actualInputPath) {
      try {
        await addNativeComments(actualInputPath, outputPath, comments)
        return { success: true, outputPath, mode: 'source_comments' }
      } catch (error) {
        if (!options.allowReportFallback) {
          return {
            success: false,
            error: `源文件批注失败，未生成报告伪装为批注版：${error instanceof Error ? error.message : String(error)}`,
          }
        }
        await createReportDocx(
          outputPath,
          data,
          comments,
          `源文件无法写入 Word 原生批注，已生成降级报告：${error instanceof Error ? error.message : String(error)}`
        )
        return { success: true, outputPath, mode: 'report_fallback' }
      }
    }

    if (!options.allowReportFallback) {
      return {
        success: false,
        error: '缺少可写入批注的源文件，未生成报告伪装为批注版',
      }
    }

    await createReportDocx(outputPath, data, comments, '源文件不是可写 docx，已生成批注报告版本。')
    return { success: true, outputPath, mode: 'report_fallback' }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
