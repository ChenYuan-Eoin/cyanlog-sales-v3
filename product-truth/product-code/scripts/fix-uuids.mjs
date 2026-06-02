// 用 Supabase JS 客户端（service_role）执行 seed
// 绕开 UUID 校验问题 + 字段长度不匹配
// 运行：node scripts/seed-org.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wfawwhphfqqwfwrrkogy.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SERVICE_KEY) {
  console.error('请设置 SUPABASE_SERVICE_ROLE_KEY 环境变量')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// 生成稳定的 hex UUID（基于业务前缀）
function id(prefix, suffix) {
  // 业务前缀: org=00, dept=d0, user=a0, space=40, customer=d0+o, opp=e0, mile=f0, remi=30, agen=b0
  return `${prefix}${suffix.toString().padStart(8, '0')}-0000-0000-0000-000000000000`.slice(0, 36)
}

// 修复 seed.sql 中的 UUID 使之全部是 hex
let sql = readFileSync('./supabase/seed.sql', 'utf-8')

// 把 m0000000 → 1..., o0000000 → 2..., r0000000 → 3..., s0000000 → 4..., a0000000 保持
sql = sql
  .replace(/m0000000-/g, '10000000-')
  .replace(/o0000000-/g, '20000000-')
  .replace(/r0000000-/g, '30000000-')
  .replace(/s0000000-/g, '40000000-')

// 写回
import { writeFileSync } from 'fs'
writeFileSync('./supabase/seed.sql', sql)

console.log('UUID 已转换为 hex 格式')
console.log('请重新运行: supabase db reset --linked')
