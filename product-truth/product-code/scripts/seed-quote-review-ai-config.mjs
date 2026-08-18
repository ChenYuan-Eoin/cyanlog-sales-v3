// F053：报价审核 AI 助手一键激活脚本
// 默认 dry-run：读取现有云端 provider（AI_LEVEL_2）凭据 → 构造六对象资产 → 打印清单（不写库）
// --apply：插入 configs（发布 AI_CONFIG，六对象；需用户授权后运行）
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
const APPLY = process.argv.includes('--apply')

const { data: level2, error } = await sb.from('configs').select('org_id,value').eq('key', 'AI_LEVEL_2').eq('status', 'PUBLISHED').single()
if (error || !level2) {
  console.error('❌ 未找到 AI_LEVEL_2（云端 provider），无法复用凭据')
  process.exit(1)
}
const v = level2.value || {}
const baseUrl = String(v.base_url || '')
const model = String(v.model || '')
const apiKey = v.api_key ? String(v.api_key) : undefined
if (!baseUrl || !model) {
  console.error('❌ AI_LEVEL_2 缺少 base_url/model')
  process.exit(1)
}
console.log('✅ 复用云端 provider:', baseUrl, '/', model)

const assets = [
  { schema_version: 'ai-platform.v1', asset_id: 'pc_quote_review_cloud', enabled: true, kind: 'provider_connection', provider_type: 'openai_compatible', runtime_location: 'cloud', auth_mode: apiKey ? 'bearer' : 'none', base_url: baseUrl.replace(/\/+$/, ''), ...(apiKey ? { api_key: apiKey } : {}), connection_timeout_ms: 30000 },
  { schema_version: 'ai-platform.v1', asset_id: 'mce_quote_review', enabled: true, kind: 'model_catalog_entry', provider_connection_id: 'pc_quote_review_cloud', model_id: model, capabilities: ['text_generation', 'structured_output'] },
  { schema_version: 'ai-platform.v1', asset_id: 'app_quote_review', enabled: true, kind: 'ai_application', capabilities: ['text_generation', 'structured_output'] },
  { schema_version: 'ai-platform.v1', asset_id: 'quote.review.assistant', enabled: true, kind: 'business_use_point', module_id: 'quote', required_capabilities: ['text_generation', 'structured_output'] },
  { schema_version: 'ai-platform.v1', asset_id: 'bind_quote_review', enabled: true, kind: 'application_binding', business_use_point_id: 'quote.review.assistant', ai_application_id: 'app_quote_review' },
  { schema_version: 'ai-platform.v1', asset_id: 'route_quote_review', enabled: true, kind: 'route_policy', ai_application_id: 'app_quote_review', model_catalog_entry_ids: ['mce_quote_review'], strategy: 'ordered_fallback', timeout_ms: 120000, failure_action: 'manual_review' },
]

if (!APPLY) {
  console.log('\n[dry-run] 将发布 6 条 AI_CONFIG（quote.review.assistant 激活清单）：')
  for (const a of assets) console.log(`  - ${a.kind}: ${a.asset_id}${a.kind === 'provider_connection' ? '（凭据复用 AI_LEVEL_2，api_key 仅在本机存在）' : ''}`)
  console.log('\n编译验证：见 lib/review/ai-config-seed.test.ts（六对象可编译出运行计划）')
  console.log('执行激活：node scripts/seed-quote-review-ai-config.mjs --apply')
  process.exit(0)
}

const orgId = level2.org_id
const names = {
  pc_quote_review_cloud: '报价审核-云端连接',
  mce_quote_review: '报价审核-模型目录项',
  app_quote_review: '报价审核应用',
  'quote.review.assistant': '报价审核业务用点',
  bind_quote_review: '报价审核应用绑定',
  route_quote_review: '报价审核路由策略',
}
for (const a of assets) {
  const { error: insErr } = await sb.from('configs').insert({
    org_id: orgId,
    key: a.asset_id.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
    name: names[a.asset_id] ?? a.asset_id,
    value: a,
    type: 'AI_CONFIG',
    status: 'PUBLISHED',
  })
  if (insErr) {
    console.error(`❌ 发布 ${a.asset_id} 失败:`, insErr.message)
    process.exit(1)
  }
  console.log(`✅ 发布 ${a.kind}: ${a.asset_id}`)
}
console.log('\n🎉 quote.review.assistant 已激活。打开任意报价详情 → 审核核验 → AI 审核意见。')
