import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261030090000_fxiaoke_sso_state_bootstrap.sql'),
  'utf8',
)

describe('Fxiaoke SSO bootstrap migration', () => {
  it('installs only the state and stable-identity prerequisites', () => {
    expect(sql).toContain('organization_fxiaoke_oauth_states')
    expect(sql).toContain('consume_fxiaoke_oauth_state')
    expect(sql).toContain('external_identities_source_canonical_unique')
    expect(sql).toContain("where match_status = 'matched' and canonical_user_id is not null")
  })

  it('does not rewrite phones or bypass the canonical phone-history contract', () => {
    expect(sql).not.toMatch(/update\s+public\.users/i)
    expect(sql).not.toContain('phone_history')
    expect(sql).not.toContain('btree_gist')
    expect(sql).not.toContain('employee_number =')
  })

  it('keeps OAuth state server-only', () => {
    expect(sql).toContain('alter table public.organization_fxiaoke_oauth_states enable row level security')
    expect(sql).toContain('revoke all on public.organization_fxiaoke_oauth_states')
    expect(sql).toContain('revoke all on function public.consume_fxiaoke_oauth_state(text)')
    expect(sql).toContain('grant execute on function public.consume_fxiaoke_oauth_state(text) to service_role')
  })
})
