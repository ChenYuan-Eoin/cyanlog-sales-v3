import JSZip from 'jszip'

export type BatchDraftRow = { id: number; key: string; recipient: string; phone: string; address: string; cargo: string; result?: 'pending' | 'success' | 'failed'; error?: string; waybill?: string }

const headerAliases: Record<string, keyof Pick<BatchDraftRow, 'recipient' | 'phone' | 'address' | 'cargo'>> = {
  收件人: 'recipient', 收件人姓名: 'recipient', 姓名: 'recipient',
  联系电话: 'phone', 手机号: 'phone', 电话: 'phone', 手机: 'phone',
  收件地址: 'address', 详细地址: 'address', 地址: 'address',
  物品: 'cargo', 托寄物: 'cargo', 物品名称: 'cargo',
}

function keyFor(index: number) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
}

function rowsFromGrid(grid: string[][]): BatchDraftRow[] {
  const header = grid[0]?.map(value => value.trim().replace(/^\uFEFF/, '')) || []
  const columns = header.map(value => headerAliases[value] || null)
  if (!columns.includes('recipient') || !columns.includes('phone') || !columns.includes('address')) throw new Error('模板需包含收件人、联系电话和收件地址列。')
  return grid.slice(1).filter(row => row.some(Boolean)).slice(0, 200).map((row, index) => {
    const result: BatchDraftRow = { id: index + 1, key: keyFor(index), recipient: '', phone: '', address: '', cargo: '文件/合同' }
    columns.forEach((field, column) => { if (field) result[field] = (row[column] || '').trim() })
    return result
  })
}

export function parseCsv(text: string): BatchDraftRow[] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') { if (quoted && text[index + 1] === '"') { cell += '"'; index += 1 } else quoted = !quoted }
    else if (char === ',' && !quoted) { row.push(cell); cell = '' }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[index + 1] === '\n') index += 1; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += char
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rowsFromGrid(rows)
}

function xmlText(value: string) { return value.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"') }
function columnOf(reference: string) { let value = 0; for (const char of reference.match(/[A-Z]+/)?.[0] || 'A') value = value * 26 + char.charCodeAt(0) - 64; return value - 1 }

export async function parseXlsx(buffer: ArrayBuffer): Promise<BatchDraftRow[]> {
  const zip = await JSZip.loadAsync(buffer)
  const sheet = await zip.file('xl/worksheets/sheet1.xml')?.async('string')
  if (!sheet) throw new Error('Excel 文件缺少第一个工作表。')
  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string')
  const shared = sharedXml ? [...sharedXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map(match => xmlText(match[1])) : []
  const grid = [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(rowMatch => {
    const row: string[] = []
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1], body = cellMatch[2], reference = attributes.match(/\br="([A-Z]+\d+)"/)?.[1] || 'A1'
      const raw = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? body.match(/<is[^>]*>([\s\S]*?)<\/is>/)?.[1] ?? ''
      row[columnOf(reference)] = /\bt="s"/.test(attributes) ? shared[Number(raw)] || '' : xmlText(raw)
    }
    return row
  })
  return rowsFromGrid(grid)
}

export async function parseShippingFile(file: File): Promise<BatchDraftRow[]> {
  const suffix = file.name.toLowerCase().split('.').pop()
  if (suffix === 'csv') return parseCsv(await file.text())
  if (suffix === 'xlsx') return parseXlsx(await file.arrayBuffer())
  throw new Error('仅支持 .xlsx 或 .csv 文件。')
}

function escapeXml(value: string) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
export async function buildShippingTemplate(): Promise<Blob> {
  const zip = new JSZip(), cells = ['收件人', '联系电话', '收件地址', '物品'].map((value, index) => `<c r="${String.fromCharCode(65 + index)}1" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`).join('')
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="顺丰批量导入" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cells}</row></sheetData></worksheet>`)
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function batchRowErrors(row: BatchDraftRow) {
  const errors: string[] = []
  if (!row.recipient.trim()) errors.push('缺少收件人')
  if (!/^1[3-9]\d{9}$/.test(row.phone.trim())) errors.push('手机号需为11位')
  if (row.address.trim().length < 8 || !/[省市区县]/.test(row.address)) errors.push('地址需包含省市区及门牌')
  return errors
}
