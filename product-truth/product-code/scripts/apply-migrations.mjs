// 批量执行 SQL 迁移
// 用 pg 直连 Supabase，绕过 PostgREST 的 DDL 限制

import { Client } from 'pg'
import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations')

// Supabase 直连 connection string
// 格式: postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
const PROJECT_REF = 'wfawwhphfqqwfwrrkogy'

// 用 service_role JWT 作为密码（Supabase 支持）
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ 缺少 SUPABASE 环境变量')
  console.error('   使用 --env-file=.env.local 或设置环境变量')
  process.exit(1)
}

// Supabase 直连信息（生产环境通用）
const connectionConfig = {
  host: `aws-1-ap-southeast-1.pooler.supabase.com`,
  port: 5432,
  database: 'postgres',
  user: `postgres.${PROJECT_REF}`,
  password: SERVICE_KEY,
  ssl: { rejectUnauthorized: false },
}

async function runMigrations() {
  const client = new Client(connectionConfig)
  await client.connect()
  console.log('✅ 已连接到 Supabase\n')

  // 查找所有 SQL 迁移文件
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  console.log(`📋 发现 ${files.length} 个迁移文件:\n`)

  for (const file of files) {
    const filePath = path.join(MIGRATIONS_DIR, file)
    const sql = readFileSync(filePath, 'utf-8')

    console.log(`▶️  执行: ${file}`)
    try {
      await client.query(sql)
      console.log(`   ✅ 成功\n`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('already exists')) {
        console.log(`   ⏭️  跳过（表/索引已存在）\n`)
      } else {
        console.error(`   ❌ 失败: ${msg}\n`)
        await client.end()
        process.exit(1)
      }
    }
  }

  await client.end()
  console.log('🎉 所有迁移执行完成')
}

runMigrations().catch((err) => {
  console.error('❌ 致命错误:', err)
  process.exit(1)
})
