import { Client } from 'pg'

// 尝试 service_role JWT 作为密码 + 各种组合
const tries = [
  { host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432, user: 'postgres.wfawwhphfqqwfwrrkogy', pw: process.env.SUPABASE_SERVICE_ROLE_KEY },
  { host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 6543, user: 'postgres.wfawwhphfqqwfwrrkogy', pw: process.env.SUPABASE_SERVICE_ROLE_KEY },
  { host: 'db.wfawwhphfqqwfwrrkogy.supabase.co', port: 5432, user: 'postgres', pw: process.env.SUPABASE_SERVICE_ROLE_KEY },
]

for (const cfg of tries) {
  const client = new Client({
    ...cfg,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  })
  try {
    await client.connect()
    const r = await client.query('SELECT 1 as ok')
    console.log(`✅ ${cfg.host}:${cfg.port} user=${cfg.user} → ${JSON.stringify(r.rows[0])}`)
    await client.end()
  } catch (err) {
    console.log(`❌ ${cfg.host}:${cfg.port} user=${cfg.user} → ${err.message?.substring(0, 80)}`)
  }
}
