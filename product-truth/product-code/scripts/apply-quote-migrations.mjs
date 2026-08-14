// 仅应用报价域 3 个新迁移（20260814000001/2/3），不动全量历史
import { Client } from 'pg'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_PATH = process.argv[2]
if (!ENV_PATH) {
  console.error('用法: node scripts/apply-quote-migrations.mjs <path/to/.env.local>')
  process.exit(1)
}

function loadEnv(file) {
  const env = {}
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    env[m[1]] = v
  }
  return env
}

const env = loadEnv(ENV_PATH)
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
if (!SERVICE_KEY || !SUPABASE_URL) {
  console.error('❌ 缺少 SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL')
  process.exit(1)
}
console.log('✅ env loaded (url:', SUPABASE_URL, ')')

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres.wfawwhphfqqwfwrrkogy',
  password: SERVICE_KEY,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
})
await client.connect()
console.log('✅ connected\n')

const files = [
  '20260814000001_quote_domain_config_tables.sql',
  '20260814000002_quote_version_snapshot.sql',
  '20260814000003_seed_quote_domain_config.sql',
  '20260814000004_add_fx_rate_type_param.sql',
]
for (const file of files) {
  const sql = readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', file), 'utf-8')
  console.log(`▶️  ${file}`)
  try {
    await client.query(sql)
    console.log('   ✅ ok')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/already exists|duplicate key|column .* already exists/i.test(msg)) {
      console.log('   ⏭️  skip:', msg.split('\n')[0])
    } else {
      console.log('   ❌ ERROR:', msg.split('\n')[0])
      process.exitCode = 1
    }
  }
}
await client.end()
console.log('\n🏁 done')
