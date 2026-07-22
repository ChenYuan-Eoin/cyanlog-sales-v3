import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const here = dirname(fileURLToPath(import.meta.url))
const fixedDate = new Date('2026-07-18T04:00:00.000Z')

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function paragraph(text, { style, bold = false, pageBreakBefore = false } = {}) {
  const properties = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    '<w:spacing w:after="140" w:line="360" w:lineRule="auto"/>',
  ].join('')
  return `<w:p><w:pPr>${properties}</w:pPr><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

function table(rows) {
  const body = rows.map((row) => `<w:tr>${row.map((cell) => (
    `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${paragraph(cell)}</w:tc>`
  )).join('')}</w:tr>`).join('')
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="94A3B8"/><w:left w:val="single" w:sz="4" w:color="94A3B8"/><w:bottom w:val="single" w:sz="4" w:color="94A3B8"/><w:right w:val="single" w:sz="4" w:color="94A3B8"/><w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/></w:tblBorders></w:tblPr>${body}</w:tbl>`
}

async function buildDocx(filename, title, clauses, commercialRows) {
  const zip = new JSZip()
  const add = (path, content) => zip.file(path, content, { date: fixedDate })

  add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`)
  add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`)
  add('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>Price V3 G6 acceptance fixture</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2026-07-18T04:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-07-18T04:00:00Z</dcterms:modified></cp:coreProperties>`)
  add('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Price V3 Fixture Generator</Application><Pages>2</Pages><Words>220</Words></Properties>`)
  add('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`)
  add('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:color w:val="1E3A8A"/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`)
  add('word/header1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${paragraph('青岚科技｜采购框架合同｜受控验收样本')}</w:hdr>`)
  add('word/footer1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${paragraph('CONFIDENTIAL · G6 immutable comparison acceptance · 2026-07-18')}</w:ftr>`)

  const body = [
    paragraph(title, { style: 'Title' }),
    paragraph('甲方：上海青岚科技有限公司'),
    paragraph('乙方：杭州海岳软件有限公司'),
    paragraph('合同编号：QL-G6-2026-0718 🚀'),
    paragraph('第一章 商务条款', { style: 'Heading1' }),
    ...clauses.slice(0, 4).map((clause) => paragraph(clause)),
    table(commercialRows),
    paragraph('第二章 履约与责任', { style: 'Heading1', pageBreakBefore: true }),
    ...clauses.slice(4).map((clause) => paragraph(clause)),
    paragraph('以下重复条款用于验证确定性定位：未经书面同意，任何一方不得转让本合同。'),
    paragraph('以下重复条款用于验证确定性定位：未经书面同意，任何一方不得转让本合同。'),
    paragraph('（以下无正文）'),
  ].join('')
  add('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1260" w:bottom="1440" w:left="1260" w:header="720" w:footer="720"/></w:sectPr></w:body></w:document>`)

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } })
  await writeFile(resolve(here, filename), buffer)
}

await mkdir(here, { recursive: true })
await buildDocx('old-contract-v1.docx', '软件采购框架合同（旧版 V1）', [
  '1. 合同总价为人民币 500,000 元（含税），税率为 6%。',
  '2. 付款安排：合同生效后 10 个工作日内支付 50%，验收后支付剩余 50%。',
  '3. 验收期限为交付后 5 个工作日；逾期未反馈视为验收通过。',
  '4. 服务期自 2026 年 8 月 1 日起至 2027 年 7 月 31 日止。',
  '5. 乙方逾期交付的，每日按合同总价的 0.1% 支付违约金，累计不超过合同总价的 10%。',
  '6. 任一方泄露保密信息，应赔偿守约方全部直接损失。',
  '7. 争议由甲方所在地有管辖权的人民法院处理。',
], [
  ['项目', '数量', '单价（元）'],
  ['合同审阅平台', '1 套', '420,000'],
  ['实施与培训', '1 项', '80,000'],
])

await buildDocx('new-contract-v2.docx', '软件采购框架合同（客户修改版 V2）', [
  '1. 合同总价为人民币 560,000 元（含税），税率为 6%。',
  '2. 付款安排：合同生效后 10 个工作日内支付 30%，上线后支付 40%，验收后支付剩余 30%。',
  '3. 验收期限为交付后 10 个工作日；必须由甲方书面确认后方可视为验收通过。',
  '4. 服务期自 2026 年 9 月 1 日起至 2027 年 8 月 31 日止。',
  '5. 乙方逾期交付的，每日按合同总价的 0.3% 支付违约金，累计不设上限。',
  '6. 任一方泄露保密信息，应赔偿守约方全部损失，包括间接损失和维权费用。',
  '7. 争议提交杭州仲裁委员会仲裁，仲裁地为杭州。',
  '8. 甲方可提前 7 日书面通知无理由终止合同，乙方应退还全部已付款项。',
], [
  ['项目', '数量', '单价（元）'],
  ['合同审阅平台企业版', '1 套', '460,000'],
  ['实施、迁移与培训', '1 项', '100,000'],
])
