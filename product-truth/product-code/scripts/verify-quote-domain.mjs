// 真库验收（远程 Supabase，用户已授权）
// 用 supabaseAdmin（service role）走 PostgREST；价盘数学校验复用与纯函数同口径的本地实现
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// ---- env ----
function loadEnv(file) {
  const env = {}
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    env[m[1]] = v
  }
  return env
}
const env = loadEnv('.vercel/.env.development.local')
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const E = (label, ok, detail = '') => console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`)
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// ---- 1. schema/counts ----
const counts = {}
for (const table of ['product_versions', 'business_params', 'field_dictionaries', 'document_number_rules', 'clause_mappings', 'output_templates', 'approval_chains', 'approval_chain_nodes', 'approval_rules', 'price_matrix', 'quote_versions', 'quote_snapshots']) {
  const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true })
  counts[table] = error ? `ERR:${error.message.slice(0, 60)}` : count
}
console.log('表计数:', JSON.stringify(counts))
E('配置域表存在', !Object.values(counts).some((v) => typeof v === 'string' && v.startsWith('ERR')))

// ---- 2. org ----
const { data: orgs } = await sb.from('organizations').select('id').limit(1)
const orgId = orgs?.[0]?.id
E('org 存在', !!orgId, orgId)

// ---- 3. price matrix import ----
const { data: projectProducts } = await sb.from('products').select('id, code').eq('org_id', orgId).in('code', ['PROJECT'])
let projectId = projectProducts?.[0]?.id
if (!projectId) {
  const { data: ins } = await sb.from('products').insert({ org_id: orgId, code: 'PROJECT', name: 'ONES Project 项目管理平台', specification: '项目管理平台', unit: '账号', base_price: 0, min_price: 0, status: 'active', attributes: { category: 'BASE', standalone: true, follows: [], version_codes: ['STD_V6', 'PRO_V6', 'ENT_V6', 'XINCHUANG_V6'] } }).select('id').single()
  projectId = ins.id
}
E('PROJECT 产品就绪', !!projectId, projectId)

// 解析 dump（与 lib/config-center/price-import 同口径）
const text = readFileSync('lib/config-center/__fixtures__/price-table-dump.txt', 'utf-8')
const DEPLOY = { 公有云: 'PUBLIC_CLOUD', 私有部署: 'PRIVATE', 高可用部署: 'HA' }
const AUTH = { 按年订阅版: 'SUB_YEAR', 三年订阅版: 'SUB_3YEAR', 一次性授权版: 'ONETIME' }
const rows = []
let deployment = 'PUBLIC_CLOUD', authMode = 'SUB_YEAR', termMonths = 12
for (const line of text.split('\n')) {
  if (!line.includes('|')) continue
  const cells = {}
  for (const cell of line.split('|')) {
    const m = /^\s*([A-Z]+)\d*=(.+)$/.exec(cell)
    if (m) cells[m[1]] = m[2].trim()
  }
  if (cells.A) deployment = DEPLOY[cells.A] || cells.A
  if (cells.B) { authMode = AUTH[cells.B] || cells.B; termMonths = authMode === 'ONETIME' ? null : cells.E === '36' ? 36 : 12 }
  if (cells.E) termMonths = authMode === 'ONETIME' ? null : cells.E === '36' ? 36 : 12
  if (!cells.D) continue
  const range = cells.D.replace(/,/g, '')
  let qtyFrom, qtyTo
  if (range.includes('+')) { qtyFrom = Number(range.split('+')[0].trim()) + 1; qtyTo = null }
  else { const p = range.split('-').map((x) => Number(x.trim())); if (p.length !== 2) continue; qtyFrom = p[0]; qtyTo = p[1] }
  const toNum = (v) => (v === undefined || v === '' || v === '/' || v === '请联系我们') ? null : Number(v.replace(/,/g, ''))
  for (const [vc, lc, uc] of [['STD_V6', 'F', 'G'], ['PRO_V6', 'H', 'I'], ['ENT_V6', 'J', 'K'], ['XINCHUANG_V6', 'L', 'M']]) {
    const lp = toNum(cells[lc]); const up = toNum(cells[uc])
    if (lp === null && up === null) continue
    rows.push({ org_id: orgId, product_id: projectId, version_code: vc, deployment, auth_mode: authMode, term_months: termMonths, currency: 'CNY', qty_from: qtyFrom, qty_to: qtyTo, unit_price: up, list_price: lp, status: 'PUBLISHED', version: 1 })
  }
}
console.log(`[IMPORT] parsed ${rows.length} rows`)
// 先清空该产品的旧矩阵（幂等）
await sb.from('price_matrix').delete().eq('org_id', orgId).eq('product_id', projectId)
const { error: insErr } = await sb.from('price_matrix').insert(rows)
E('价盘导入 585 行落库', !insErr, insErr ? insErr.message.slice(0, 200) : `rows=${rows.length}`)

// ---- 4. math check（从 DB 取回，按同口径校验）----
const { data: matrix } = await sb.from('price_matrix').select('*').eq('org_id', orgId).eq('product_id', projectId)
let checked = 0, issues = 0
const groups = new Map()
for (const r of matrix) {
  const k = [r.product_id, r.version_code, r.deployment, r.auth_mode, r.term_months ?? '', r.currency].join('|')
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k).push(r)
}
for (const g of groups.values()) {
  g.sort((a, b) => a.qty_from - b.qty_from)
  let prevUpper = 0, prevList = 0
  for (const r of g) {
    if (r.qty_to === null || r.unit_price === null || r.list_price === null) { prevUpper = r.qty_to ?? prevUpper; continue }
    const delta = r.qty_to - prevUpper
    const expected = round2(prevList + r.unit_price * delta)
    if (Math.abs(expected - r.list_price) > 0.01) issues++
    else checked++
    prevUpper = r.qty_to; prevList = r.list_price
  }
}
E('价盘数学一致性（DB 取回）', issues === 0, `checked=${checked} issues=${issues}`)

// ---- 5. 审批配置解析（无人名）----
const { data: rules } = await sb.from('approval_rules').select('*').eq('org_id', orgId).eq('status', 'PUBLISHED')
const { data: chains } = await sb.from('approval_chains').select('*').eq('org_id', orgId).eq('status', 'PUBLISHED')
const chainIds = chains.map((c) => c.id)
const { data: nodes } = chainIds.length ? await sb.from('approval_chain_nodes').select('*').in('chain_id', chainIds) : { data: [] }
const nameRe = /[\u4e00-\u9fa5]{2,4}/
const badNodes = nodes.filter((n) => n.assignee_type === 'user' ? !/^[0-9a-fA-F-]{36}$/.test(n.assignee_value) : nameRe.test(n.assignee_value))
E('审批种子存在且节点无人名', rules.length >= 2 && chains.length >= 2 && badNodes.length === 0, `rules=${rules.length} chains=${chains.length} nodes=${nodes.length}`)

// ---- 6. E2E：建结构化报价 → 冻结 → 版本/快照 ----
const { data: quoteIns, error: qErr } = await sb.from('quotes').insert({
  org_id: orgId, quote_no: `QT-E2E-${Date.now()}`, customer_name: '深圳市云启数字科技有限公司', customer_contact: '', currency: 'CNY',
  discount_rate: 0, subtotal: 15000, discount_amount: 0, tax_rate: 0.13, tax_amount: 1950, total_amount: 16950,
  amount_in_words: '壹万陆仟玖佰伍拾元整', status: 'APPROVED', notes: 'e2e verify', valid_until: new Date(Date.now() + 15 * 86400000).toISOString(),
}).select('id, quote_no').single()
E('E2E 报价创建', !qErr && !!quoteIns, quoteIns?.quote_no)
if (!qErr && quoteIns) {
  const { error: itErr } = await sb.from('quote_items').insert({
    quote_id: quoteIns.id, product_type: 'sku', product_id: projectId, product_code: 'PROJECT', name: 'ONES Project 企业版 V6',
    quantity: 10, unit_price: 1500, list_price: 15000, line_total: 15000, sort_order: 0, pricing_source: 'tier', tier_range: '1-10',
    version_code: 'ENT_V6', deployment: 'PUBLIC_CLOUD', auth_mode: 'SUB_YEAR', term_months: 12, is_gift: false,
  })
  E('E2E 明细写入', !itErr, itErr?.message?.slice(0, 120))
  const { data: fid, error: fErr } = await sb.rpc('freeze_quote', { p_quote_id: quoteIns.id, p_user_id: null })
  E('freeze_quote RPC', !fErr && !!fid, fErr ? fErr.message.slice(0, 200) : `version_id=${fid}`)
  if (!fErr && fid) {
    const { data: version } = await sb.from('quote_versions').select('*').eq('id', fid).single()
    const { data: vitems } = await sb.from('quote_version_items').select('*').eq('version_id', fid)
    const { data: snap } = await sb.from('quote_snapshots').select('*').eq('quote_id', quoteIns.id).eq('version_no', version.version_no).single()
    const headerOk = version.header.customer_name === '深圳市云启数字科技有限公司' && version.header.total_amount === 16950
    const itemOk = vitems.length === 1 && vitems[0].version_code === 'ENT_V6' && vitems[0].deployment === 'PUBLIC_CLOUD' && vitems[0].auth_mode === 'SUB_YEAR' && vitems[0].term_months === 12 && vitems[0].list_price === 15000
    const snapOk = snap && JSON.stringify(snap.snapshot.header) === JSON.stringify(version.header) && snap.snapshot.items.length === vitems.length
    E('结构化版本可读（合同源数据：价格/数量/版本/部署/授权/期限）', headerOk && itemOk)
    E('中间快照与版本逐位一致', !!snapOk, `snapshot_id=${snap?.id}`)
    const { data: qrow } = await sb.from('quotes').select('version_no').eq('id', quoteIns.id).single()
    E('报价版本号已更新', qrow?.version_no === version.version_no, `version_no=${qrow?.version_no}`)
  }
}
console.log('🏁 真库验收脚本结束')
