// REQ: WP10. Run before any E2E fixture writes.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!url || new URL(url).hostname !== 'vsfropnfsmnonkotywsx.supabase.co') {
  throw new Error('E2E requires the approved isolated Supabase project; refusing fixture writes')
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing isolated service role credential')
console.log('Isolated database target verified')
