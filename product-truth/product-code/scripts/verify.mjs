import { createClient } from '@supabase/supabase-js'
const supabase = createClient('https://wfawwhphfqqwfwrrkogy.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmYXd3aHBoZnFxd2Z3cnJrb2d5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDAwMTMwNCwiZXhwIjoyMDk1NTc3MzA0fQ.VRvRGf55oTyfBJ38fNwujxe-MRIxQzWtp97vEKZaEsc')
const tables = ['organizations','roles','departments','users','user_departments','user_roles','sales_spaces','sales_space_members','customers','opportunities','milestones','reminders','agenda_items']
for (const t of tables) {
  const { count } = await supabase.from(t).select('*', { count: 'exact', head: true })
  console.log(`${t.padEnd(22)} ${count}`)
}
