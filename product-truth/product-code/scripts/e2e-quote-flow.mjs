// 真实应用 API 全流程（登录→结构化建单→审批→冻结→导出脱敏）
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

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
const BASE = 'http://localhost:3100'
const E = (label, ok, detail = '') => console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`)

// 1. 登录
const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'e2e-admin@huarun.com', password: 'E2ETestPassword123!' }) })
const loginJson = await login.json()
const token = loginJson?.token || loginJson?.data?.token || loginJson?.access_token
E('登录', login.ok && !!token, `http=${login.status}`)
const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }

// 2. 结构化建单（PROJECT 企业版公有云按年订阅 10 账号，折扣 40%）
const { data: proj } = await sb.from('products').select('id').eq('code', 'PROJECT').limit(1).single()
const createRes = await fetch(`${BASE}/api/quotes`, {
  method: 'POST', headers,
  body: JSON.stringify({
    customer_name: '真库验收客户', customer_contact: '张三', valid_until: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10), notes: 'e2e real flow', discount_rate: 0.4,
    items: [{ product_type: 'sku', product_id: proj.id, quantity: 10, unit_price: 1500, discount: 0, sort_order: 0, version_code: 'ENT_V6', deployment: 'PUBLIC_CLOUD', auth_mode: 'SUB_YEAR', term_months: 12, list_price: 15000 }],
  }),
})
const createJson = await createRes.json()
const quote = createJson?.data || createJson
E('结构化建单（服务端累计计价）', createRes.ok && !!quote?.id, `quote_no=${quote?.quote_no}`)
if (!quote?.id) { console.log(JSON.stringify(createJson).slice(0, 400)); process.exit(1) }
const qid = quote.id
E('金额口径（折扣 40% 后合计）', Number(quote.total_amount) === 10170, `total=${quote.total_amount}`)

// 2.1 F042：FX_SOURCE=BOC 时创建报价自动带中行牌价（1 USD = 中行折算价/100 CNY）
const { data: fxRow } = await sb.from('quotes').select('currency, exchange_rate').eq('id', qid).single()
E('BOC 汇率自动带出（FX_SOURCE=BOC）', fxRow?.currency === 'CNY' && typeof fxRow?.exchange_rate === 'number' && fxRow.exchange_rate > 0, `rate=${fxRow?.exchange_rate}`)

// 3. 提交审批 → 应自动创建审批链（40% → <50 → ROLE_SPECIAL）
const submit = await fetch(`${BASE}/api/quotes/${qid}`, { method: 'PUT', headers, body: JSON.stringify({ status: 'PENDING_APPROVAL' }) })
const submitJson = await submit.json()
E('提交审批', submit.ok, `http=${submit.status}`)
await new Promise((r) => setTimeout(r, 1500))
const { data: approvals } = await sb.from('approvals').select('*').eq('quote_id', qid)
const noName = (approvals || []).every((a) => !/[\u4e00-\u9fa5]{2,4}/.test(a.approver_role || ''))
E('审批自动创建且角色无人名', (approvals || []).length >= 1 && noName, `approvals=${approvals?.length} role=${approvals?.[0]?.approver_role}`)

// 4. 批准
const approve = await fetch(`${BASE}/api/quotes/${qid}`, { method: 'PUT', headers, body: JSON.stringify({ status: 'APPROVED' }) })
E('批准', approve.ok, `http=${approve.status}`)

// 5. 冻结 → 版本+快照
const freeze = await fetch(`${BASE}/api/quotes/${qid}/freeze`, { method: 'POST', headers })
const freezeJson = await freeze.json()
E('冻结（freeze_quote RPC）', freeze.ok && freezeJson?.data?.version_id, `http=${freeze.status}`)
if (freezeJson?.data?.version_id) {
  const { data: v } = await sb.from('quote_versions').select('*').eq('id', freezeJson.data.version_id).single()
  const { data: vi } = await sb.from('quote_version_items').select('*').eq('version_id', v.id)
  const { data: sn } = await sb.from('quote_snapshots').select('*').eq('quote_id', qid).eq('version_no', v.version_no).single()
  const item = vi?.[0]
  E('版本结构化可读', v?.header?.total_amount === 10170 && item?.version_code === 'ENT_V6' && item?.deployment === 'PUBLIC_CLOUD' && item?.auth_mode === 'SUB_YEAR' && item?.term_months === 12 && item?.list_price === 15000)
  E('快照与版本逐位一致', JSON.stringify(sn?.snapshot?.header) === JSON.stringify(v?.header) && sn?.snapshot?.items?.length === vi?.length)
}

// 6. 导出（脱敏）
const exp = await fetch(`${BASE}/api/quotes/${qid}/export`, { headers: { Authorization: `Bearer ${token}` } })
const expJson = await exp.json()
const d = expJson?.data
const jsonStr = JSON.stringify(d || {})
E('导出接口', exp.ok && !!d, `http=${exp.status}`)
E('导出零泄漏（无成本/毛利/审批）', !jsonStr.includes('internal_cost') && !jsonStr.includes('margin_rate') && !jsonStr.includes('approver') && !jsonStr.includes('approval_opinion'))
E('导出含大写/水印/有效期', !!d?.total_in_words && !!d?.watermark && !!d?.valid_until, `大写=${d?.total_in_words}`)

// 7. DB 落库结构化列
const { data: stored } = await sb.from('quote_items').select('version_code, deployment, auth_mode, term_months, list_price, is_gift').eq('quote_id', qid).single()
E('quote_items 结构化列已落库', stored?.version_code === 'ENT_V6' && stored?.deployment === 'PUBLIC_CLOUD' && stored?.auth_mode === 'SUB_YEAR' && stored?.term_months === 12 && stored?.list_price === 15000)
console.log('🏁 真实 API 全流程结束，quote_no=' + quote.quote_no)
