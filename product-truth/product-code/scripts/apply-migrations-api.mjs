// 通过 Supabase pg/query 端点执行 DDL
// service_role JWT 用作 Authorization Bearer

import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ 缺少 SUPABASE 环境变量')
  process.exit(1)
}

const PG_QUERY_URL = `${SUPABASE_URL}/pg/query`

async function executeSql(sql) {
  const res = await fetch(PG_QUERY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify({ query: sql }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }

  return res.json()
}

async function runMigrations() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  console.log(`📋 发现 ${files.length} 个迁移:\n`)

  for (const file of files) {
    const filePath = path.join(MIGRATIONS_DIR, file)
    const sql = readFileSync(filePath, 'utf-8')

    console.log(`▶️  ${file} (${sql.length} chars)`)
    try {
      await executeSql(sql)
      console.log(`   ✅ 成功\n`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('already exists') || msg.includes('duplicate')) {
        console.log(`   ⏭️  跳过（已存在）\n`)
      } else {
        console.error(`   ❌ 失败: ${msg.substring(0, 200)}\n`)
        process.exit(1)
      }
    }
  }

  console.log('🎉 所有迁移完成')
}

runMigrations().catch((err) => {
  console.error('❌ 致命:', err)
  process.exit(1)
})
