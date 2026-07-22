import JSZip from 'jszip'

export const COMPARISON_REPORT_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type ComparisonReportDiffType = 'added' | 'deleted' | 'modified' | 'moved'
export type ComparisonReportRisk = 'red' | 'yellow' | 'green'

export interface ComparisonSourceSnapshotIdentity {
  snapshot_id: string
  file_name: string
  storage_path: string
  file_sha256: string
  text_sha256: string
  captured_at: string
  immutable_at_creation: true
}

export interface ComparisonSourcePosition {
  page_number: number
  start_offset: number
  end_offset: number
  locator: 'rendered' | 'provisional'
}

export interface ComparisonReportStatistics {
  total: number
  added: number
  deleted: number
  modified: number
  moved: number
  red: number
  yellow: number
  green: number
}

export interface ComparisonReportDiff {
  id: string
  sort_order: number
  type: ComparisonReportDiffType
  risk: ComparisonReportRisk
  old_source_text: string
  new_source_text: string
  old_position: ComparisonSourcePosition
  new_position: ComparisonSourcePosition
}

export interface ComparisonReportInput {
  comparison_id: string
  completed_at: string
  old_snapshot: ComparisonSourceSnapshotIdentity
  new_snapshot: ComparisonSourceSnapshotIdentity
  statistics: ComparisonReportStatistics
  diffs: ComparisonReportDiff[]
}

export interface GeneratedComparisonReport {
  buffer: Buffer
  filename: string
  mimeType: typeof COMPARISON_REPORT_MIME_TYPE
}

export class ComparisonReportValidationError extends Error {
  readonly code = 'INVALID_COMPARISON_REPORT_INPUT'

  constructor(message: string) {
    super(message)
    this.name = 'ComparisonReportValidationError'
  }
}

const SHA256_HEX = /^[a-f0-9]{64}$/i
const COMPARISON_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const DIFF_TYPES = new Set<ComparisonReportDiffType>(['added', 'deleted', 'modified', 'moved'])
const RISK_LEVELS = new Set<ComparisonReportRisk>(['red', 'yellow', 'green'])
const ZIP_ENTRY_DATE = new Date('1980-01-01T00:00:00.000Z')

type UnknownRecord = Record<string, unknown>

function invalid(message: string): never {
  throw new ComparisonReportValidationError(message)
}

function record(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${path} 必须是对象`)
  }
  return value as UnknownRecord
}

function requiredString(value: unknown, path: string, preserveWhitespace = false) {
  if (typeof value !== 'string' || !value.trim()) invalid(`${path} 不能为空`)
  return preserveWhitespace ? value : value.trim()
}

function requiredInteger(value: unknown, path: string, minimum: number) {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    invalid(`${path} 必须是不小于 ${minimum} 的安全整数`)
  }
  return value as number
}

function parseSnapshot(value: unknown, path: string): ComparisonSourceSnapshotIdentity {
  const source = record(value, path)
  const fileSha256 = requiredString(source.file_sha256, `${path}.file_sha256`).toLowerCase()
  const textSha256 = requiredString(source.text_sha256, `${path}.text_sha256`).toLowerCase()
  if (!SHA256_HEX.test(fileSha256)) invalid(`${path}.file_sha256 必须是 64 位 SHA-256`)
  if (!SHA256_HEX.test(textSha256)) invalid(`${path}.text_sha256 必须是 64 位 SHA-256`)
  if (source.immutable_at_creation !== true) invalid(`${path}.immutable_at_creation 必须为 true`)

  const capturedAt = requiredString(source.captured_at, `${path}.captured_at`)
  if (!Number.isFinite(Date.parse(capturedAt))) invalid(`${path}.captured_at 必须是有效时间`)

  return {
    snapshot_id: requiredString(source.snapshot_id, `${path}.snapshot_id`),
    file_name: requiredString(source.file_name, `${path}.file_name`),
    storage_path: requiredString(source.storage_path, `${path}.storage_path`),
    file_sha256: fileSha256,
    text_sha256: textSha256,
    captured_at: new Date(capturedAt).toISOString(),
    immutable_at_creation: true,
  }
}

function parsePosition(value: unknown, path: string): ComparisonSourcePosition {
  const source = record(value, path)
  const startOffset = requiredInteger(source.start_offset, `${path}.start_offset`, 0)
  const endOffset = requiredInteger(source.end_offset, `${path}.end_offset`, 0)
  if (endOffset < startOffset) invalid(`${path}.end_offset 不得小于 start_offset`)
  if (source.locator !== 'rendered' && source.locator !== 'provisional') {
    invalid(`${path}.locator 必须是 rendered 或 provisional`)
  }

  return {
    page_number: requiredInteger(source.page_number, `${path}.page_number`, 1),
    start_offset: startOffset,
    end_offset: endOffset,
    locator: source.locator,
  }
}

function parseStatistics(value: unknown): ComparisonReportStatistics {
  const source = record(value, 'statistics')
  return {
    total: requiredInteger(source.total, 'statistics.total', 0),
    added: requiredInteger(source.added, 'statistics.added', 0),
    deleted: requiredInteger(source.deleted, 'statistics.deleted', 0),
    modified: requiredInteger(source.modified, 'statistics.modified', 0),
    moved: requiredInteger(source.moved, 'statistics.moved', 0),
    red: requiredInteger(source.red, 'statistics.red', 0),
    yellow: requiredInteger(source.yellow, 'statistics.yellow', 0),
    green: requiredInteger(source.green, 'statistics.green', 0),
  }
}

function parseDiff(value: unknown, index: number): ComparisonReportDiff {
  const path = `diffs[${index}]`
  const source = record(value, path)
  const type = requiredString(source.type, `${path}.type`) as ComparisonReportDiffType
  const risk = requiredString(source.risk, `${path}.risk`) as ComparisonReportRisk
  if (!DIFF_TYPES.has(type)) invalid(`${path}.type 不受支持`)
  if (!RISK_LEVELS.has(risk)) invalid(`${path}.risk 不受支持`)

  if (typeof source.old_source_text !== 'string') invalid(`${path}.old_source_text 必须是字符串`)
  if (typeof source.new_source_text !== 'string') invalid(`${path}.new_source_text 必须是字符串`)
  const oldPosition = parsePosition(source.old_position, `${path}.old_position`)
  const newPosition = parsePosition(source.new_position, `${path}.new_position`)
  const oldText = source.old_source_text
  const newText = source.new_source_text
  const oldHasRange = oldPosition.end_offset > oldPosition.start_offset
  const newHasRange = newPosition.end_offset > newPosition.start_offset

  if (type === 'added') {
    if (oldText.trim() || oldHasRange) invalid(`${path} 新增项的旧侧必须是空文本和插入点`)
    if (!newText.trim() || !newHasRange) invalid(`${path} 新增项的新侧必须包含原文范围`)
  } else if (type === 'deleted') {
    if (!oldText.trim() || !oldHasRange) invalid(`${path} 删除项的旧侧必须包含原文范围`)
    if (newText.trim() || newHasRange) invalid(`${path} 删除项的新侧必须是空文本和插入点`)
  } else if (!oldText.trim() || !newText.trim() || !oldHasRange || !newHasRange) {
    invalid(`${path} 修改或移动项必须包含双侧原文范围`)
  }

  return {
    id: requiredString(source.id, `${path}.id`),
    sort_order: requiredInteger(source.sort_order, `${path}.sort_order`, 1),
    type,
    risk,
    old_source_text: oldText,
    new_source_text: newText,
    old_position: oldPosition,
    new_position: newPosition,
  }
}

function countDiffs(diffs: ComparisonReportDiff[]): ComparisonReportStatistics {
  return diffs.reduce<ComparisonReportStatistics>((counts, diff) => {
    counts.total += 1
    counts[diff.type] += 1
    counts[diff.risk] += 1
    return counts
  }, {
    total: 0,
    added: 0,
    deleted: 0,
    modified: 0,
    moved: 0,
    red: 0,
    yellow: 0,
    green: 0,
  })
}

function validateInput(input: unknown): ComparisonReportInput {
  const source = record(input, 'input')
  const comparisonId = requiredString(source.comparison_id, 'comparison_id')
  if (!COMPARISON_ID.test(comparisonId)) {
    invalid('comparison_id 只能包含字母、数字、点、下划线和连字符')
  }
  if (!Array.isArray(source.diffs)) invalid('diffs 必须是数组')
  const completedAt = requiredString(source.completed_at, 'completed_at')
  if (!Number.isFinite(Date.parse(completedAt))) invalid('completed_at 必须是有效时间')

  const diffs = source.diffs.map(parseDiff)
  const ids = new Set<string>()
  for (const diff of diffs) {
    if (ids.has(diff.id)) invalid(`diffs 包含重复 id: ${diff.id}`)
    ids.add(diff.id)
  }

  const statistics = parseStatistics(source.statistics)
  const actual = countDiffs(diffs)
  for (const key of Object.keys(actual) as Array<keyof ComparisonReportStatistics>) {
    if (statistics[key] !== actual[key]) {
      invalid(`statistics.${key} 与差异明细不一致`)
    }
  }

  return {
    comparison_id: comparisonId,
    completed_at: new Date(completedAt).toISOString(),
    old_snapshot: parseSnapshot(source.old_snapshot, 'old_snapshot'),
    new_snapshot: parseSnapshot(source.new_snapshot, 'new_snapshot'),
    statistics,
    diffs: [...diffs].sort((left, right) => (
      left.sort_order - right.sort_order
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    )),
  }
}

function xmlText(value: string) {
  let legal = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number
    if (
      codePoint === 0x9
      || codePoint === 0xa
      || codePoint === 0xd
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff)
    ) {
      legal += character
    }
  }
  return legal
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function run(text: string, options: { bold?: boolean; color?: string; size?: number } = {}) {
  const properties = [
    options.bold ? '<w:b/>' : '',
    options.color ? `<w:color w:val="${options.color}"/>` : '',
    options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : '',
  ].join('')
  const segments = text.replace(/\r\n?/g, '\n').split('\n')
  const body = segments.map((segment, index) => (
    `${index > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlText(segment)}</w:t>`
  )).join('')
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}${body}</w:r>`
}

function paragraph(
  text: string,
  options: { style?: string; bold?: boolean; color?: string; size?: number; align?: 'center' | 'left' } = {}
) {
  const properties = [
    options.style ? `<w:pStyle w:val="${options.style}"/>` : '',
    options.align ? `<w:jc w:val="${options.align}"/>` : '',
    '<w:spacing w:after="120" w:line="300" w:lineRule="auto"/>',
  ].join('')
  return `<w:p><w:pPr>${properties}</w:pPr>${run(text, options)}</w:p>`
}

function tableCell(label: string, value: string, shade?: string) {
  return [
    '<w:tc>',
    '<w:tcPr>',
    '<w:tcW w:w="4600" w:type="dxa"/>',
    shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : '',
    '</w:tcPr>',
    paragraph(label, { bold: true, color: '334155' }),
    paragraph(value),
    '</w:tc>',
  ].join('')
}

function table(rows: Array<[string, string, string?, string?]>) {
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>`)
    .join('')
  return [
    '<w:tbl>',
    `<w:tblPr><w:tblW w:w="9200" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar></w:tblPr>`,
    '<w:tblGrid><w:gridCol w:w="4600"/><w:gridCol w:w="4600"/></w:tblGrid>',
    ...rows.map(([leftLabel, leftValue, rightLabel, rightValue]) => (
      `<w:tr>${tableCell(leftLabel, leftValue, 'F8FAFC')}${tableCell(rightLabel || '', rightValue || '', 'F8FAFC')}</w:tr>`
    )),
    '</w:tbl>',
  ].join('')
}

function positionLabel(position: ComparisonSourcePosition) {
  const offset = `原文 UTF-16 偏移 [${position.start_offset}, ${position.end_offset})`
  return position.locator === 'rendered'
    ? `真实渲染页码：第 ${position.page_number} 页；${offset}`
    : `临时位置（非真实页码）；${offset}`
}

function typeLabel(type: ComparisonReportDiffType) {
  return ({ added: '新增', deleted: '删除', modified: '修改', moved: '移动' } as const)[type]
}

function riskLabel(risk: ComparisonReportRisk) {
  return ({ red: '红线', yellow: '需关注', green: '低风险' } as const)[risk]
}

function riskColor(risk: ComparisonReportRisk) {
  return ({ red: 'B91C1C', yellow: 'B45309', green: '047857' } as const)[risk]
}

function snapshotRows(snapshot: ComparisonSourceSnapshotIdentity): Array<[string, string, string?, string?]> {
  return [
    ['快照 ID', snapshot.snapshot_id, '文件名', snapshot.file_name],
    ['Storage 路径', snapshot.storage_path, '捕获时间', snapshot.captured_at],
    ['文件 SHA-256', snapshot.file_sha256, '文本 SHA-256', snapshot.text_sha256],
  ]
}

function documentXml(input: ComparisonReportInput) {
  const statistics = input.statistics
  const body: string[] = [
    paragraph('合同文档差异报告', { style: 'Title', bold: true, size: 36, align: 'center' }),
    paragraph(`比对任务 ID：${input.comparison_id}`, { align: 'center', color: '475569' }),
    paragraph(`比对完成时间：${input.completed_at}`, { align: 'center', color: '475569' }),
    paragraph('一、不可变源文件身份', { style: 'Heading1', bold: true, size: 28 }),
    paragraph('旧文件快照', { style: 'Heading2', bold: true, size: 24, color: 'B91C1C' }),
    table(snapshotRows(input.old_snapshot)),
    paragraph('新文件快照', { style: 'Heading2', bold: true, size: 24, color: '047857' }),
    table(snapshotRows(input.new_snapshot)),
    paragraph('二、差异统计', { style: 'Heading1', bold: true, size: 28 }),
    table([
      ['差异总数', String(statistics.total), '新增 / 删除', `${statistics.added} / ${statistics.deleted}`],
      ['修改 / 移动', `${statistics.modified} / ${statistics.moved}`, '红线 / 关注 / 低风险', `${statistics.red} / ${statistics.yellow} / ${statistics.green}`],
    ]),
    paragraph('三、差异明细', { style: 'Heading1', bold: true, size: 28 }),
  ]

  if (input.diffs.length === 0) {
    body.push(paragraph('未发现差异。统计与明细均为 0。', { color: '047857' }))
  }

  input.diffs.forEach((diff, index) => {
    body.push(
      paragraph(
        `${index + 1}. ${typeLabel(diff.type)} · ${riskLabel(diff.risk)} · ${diff.id}`,
        { style: 'Heading2', bold: true, size: 24, color: riskColor(diff.risk) }
      ),
      table([
        ['旧文件位置', positionLabel(diff.old_position), '新文件位置', positionLabel(diff.new_position)],
        ['旧文件原文', diff.old_source_text || '（无，对应位置为插入点）', '新文件原文', diff.new_source_text || '（无，对应位置为插入点）'],
      ])
    )
  })

  body.push(
    paragraph('本报告仅依据上方不可变双侧快照、原文与位置生成；只有 rendered 定位显示真实渲染页码，provisional 定位只显示临时位置与原文偏移。任何缺失或统计不一致都会阻止生成。', {
      color: '475569',
    }),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
  )

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    `<w:body>${body.join('')}</w:body>`,
    '</w:document>',
  ].join('')
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`

const ROOT_RELATIONSHIPS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`

const DOCUMENT_RELATIONSHIPS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Microsoft YaHei"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:color w:val="0F172A"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/></w:style>
</w:styles>`

function corePropertiesXml(input: ComparisonReportInput) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>合同文档差异报告</dc:title>
  <dc:subject>不可变双源快照差异审计</dc:subject>
  <dc:creator>ONES</dc:creator>
  <dc:identifier>${xmlText(input.comparison_id)}</dc:identifier>
</cp:coreProperties>`
}

const APP_PROPERTIES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>ONES Contract Compare</Application>
</Properties>`

export function buildComparisonReportFilename(comparisonId: string) {
  const validated = requiredString(comparisonId, 'comparison_id')
  if (!COMPARISON_ID.test(validated)) {
    invalid('comparison_id 只能包含字母、数字、点、下划线和连字符')
  }
  return `comparison-${validated}-difference-report.docx`
}

export async function generateComparisonReportDocx(input: unknown): Promise<GeneratedComparisonReport> {
  const validated = validateInput(input)
  const zip = new JSZip()
  const addXml = (path: string, value: string) => {
    zip.file(path, value, { date: ZIP_ENTRY_DATE })
  }

  addXml('[Content_Types].xml', CONTENT_TYPES_XML)
  addXml('_rels/.rels', ROOT_RELATIONSHIPS_XML)
  addXml('docProps/core.xml', corePropertiesXml(validated))
  addXml('docProps/app.xml', APP_PROPERTIES_XML)
  addXml('word/document.xml', documentXml(validated))
  addXml('word/styles.xml', STYLES_XML)
  addXml('word/_rels/document.xml.rels', DOCUMENT_RELATIONSHIPS_XML)

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    streamFiles: false,
  })

  return {
    buffer,
    filename: buildComparisonReportFilename(validated.comparison_id),
    mimeType: COMPARISON_REPORT_MIME_TYPE,
  }
}
