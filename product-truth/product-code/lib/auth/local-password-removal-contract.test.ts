import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261029100000_remove_local_password_auth.sql'),
  'utf8',
)

describe('local password removal migration', () => {
  it('physically drops local password state and every password auth function', () => {
    expect(sql).toContain('drop column if exists password_hash')
    expect(sql).toContain('drop column if exists must_change_password')
    for (const functionName of [
      'login_with_password_v1',
      'get_login_candidate_v1',
      'reset_org_user_password_and_revoke_sessions_v1',
      'admin_reset_password_v1',
      'accept_personnel_invitation_v1',
    ]) {
      expect(sql).toContain(functionName)
    }
  })

  it('fails closed until every active super administrator has a stable identity', () => {
    expect(sql).toContain('cannot remove local passwords before every active SUPER_ADMIN has a stable external identity')
    expect(sql).toContain("identity.match_status = 'matched'")
    expect(sql).toContain('identity.canonical_user_id = user_row.id')
  })

  it('recreates invitation activation without a password parameter', () => {
    expect(sql).toContain('create or replace function public.accept_personnel_invitation_v1(')
    expect(sql).toContain('p_token_hash text,')
    expect(sql).not.toContain('p_password_hash text')
    expect(sql).toContain("'user_status', 'active'")
  })
})
