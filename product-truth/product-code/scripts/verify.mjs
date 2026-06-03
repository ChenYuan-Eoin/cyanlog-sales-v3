import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wfawwhphfqqwfwrrkogy.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SERVICE_KEY) {
  console.error('❌ FATAL: SUPABASE_SERVICE_ROLE_KEY environment variable required')
  console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/verify.mjs')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
const tables = ['organizations','roles','departments','users','user_departments','user_roles','sales_spaces','sales_space_members','customers','opportunities','milestones','reminders','agenda_items']
for (const t of tables) {
  const { count } = await supabase.from(t).select('*', { count: 'exact', head: true })
  console.log(`${t.padEnd(22)} ${count}`)
}
