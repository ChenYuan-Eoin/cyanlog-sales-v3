// 改参数不重启生效：配置中心 API 创建/发布/更新/再发布/读取（同一运行中服务）
const BASE = 'http://localhost:3100'
const token = process.env.E2E_AUTH_TOKEN
if (!token) {
  console.error('缺少 E2E_AUTH_TOKEN；先运行 node scripts/setup-e2e-user.mjs')
  process.exit(1)
}
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
const E = (l, ok, d = '') => console.log(`${ok ? '✅' : '❌'} ${l}${d ? ' — ' + d : ''}`)

const key = 'E2E_PARAM_' + Date.now()
// 1. 创建 DRAFT
const c = await (await fetch(`${BASE}/api/config-center/business-params`, { method: 'POST', headers: H, body: JSON.stringify({ param_key: key, name: 'E2E 参数', value: 100, data_type: 'number', category: 'quote' }) })).json()
const id = c.data?.id
E('创建参数草稿', !!id, `key=${key}`)
// 2. 发布
const p1 = await (await fetch(`${BASE}/api/config-center/business-params/${id}/publish`, { method: 'POST', headers: H })).json()
E('发布 v1', p1.success === true)
// 3. 读取（已发布列表）
const list1 = await (await fetch(`${BASE}/api/config-center/business-params?status=PUBLISHED&limit=100`, { headers: H })).json()
const row1 = list1.data?.find((r) => r.id === id)
E('运行中服务读到 v1=100', Number(row1?.value) === 100, `value=${row1?.value}`)
// 4. 更新为 200（不重启）
const u = await (await fetch(`${BASE}/api/config-center/business-params/${id}`, { method: 'PUT', headers: H, body: JSON.stringify({ param_key: key, name: 'E2E 参数', value: 200, data_type: 'number', category: 'quote' }) })).json()
E('更新草稿为 200', u.success === true)
// 5. 再发布
const p2 = await (await fetch(`${BASE}/api/config-center/business-params/${id}/publish`, { method: 'POST', headers: H })).json()
E('再发布 v2', p2.success === true)
// 6. 再读取 → 200（服务未重启）
const list2 = await (await fetch(`${BASE}/api/config-center/business-params?status=PUBLISHED&limit=100`, { headers: H })).json()
const row2 = list2.data?.find((r) => r.id === id)
E('改参数不重启即生效（100→200）', Number(row2?.value) === 200, `value=${row2?.value} version=${row2?.version}`)
console.log('🏁 配置读取验证结束')
