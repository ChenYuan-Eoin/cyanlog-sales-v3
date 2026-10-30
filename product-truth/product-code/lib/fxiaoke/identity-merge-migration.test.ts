import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261030100000_merge_duplicate_identity.sql'),
  'utf8',
)

describe('duplicate identity merge migration', () => {
  it('requires an explicit primary account and an active organization SUPER_ADMIN actor', () => {
    expect(sql).toContain('p_primary_user_id')
    expect(sql).toContain('p_duplicate_user_id')
    expect(sql).toContain('p_primary_user_id = p_duplicate_user_id')
    expect(sql).toContain("role.code = 'SUPER_ADMIN'")
    expect(sql).toContain("raise exception 'primary identity must be an active login-enabled member")
  })

  it('requires the primary account to be selected by the active authoritative source mapping', () => {
    expect(sql).toContain("source.status = 'active'")
    expect(sql).toContain("source.authority_scope->>'identity' = 'authoritative'")
    expect(sql).toContain('primary identity requires exactly one active authoritative source mapping')
  })

  it('merges authority and relationships without deriving identity from name or phone', () => {
    expect(sql).toContain('insert into public.user_roles')
    expect(sql).toContain('insert into public.user_departments')
    expect(sql).toContain('update public.external_identities')
    expect(sql).not.toMatch(/display_name\s*=\s*/i)
    expect(sql).not.toMatch(/phone\s*=\s*p_/i)
  })

  it('keeps the source account as inactive history and revokes its sessions', () => {
    expect(sql).toContain('delete from public.auth_tokens')
    expect(sql).toContain("status = 'inactive'")
    expect(sql).toContain('login_enabled = false')
    expect(sql).toContain("offboard_reason = 'merged_into:'")
    expect(sql).toContain('merge_duplicate_identity_source')
    expect(sql).toContain('merge_duplicate_identity_primary')
  })

  it('fails closed on two stable mappings for the same source', () => {
    expect(sql).toContain('primary and duplicate both have a stable mapping for the same source')
    expect(sql).toContain('for update')
  })

  it('is service-role only', () => {
    expect(sql).toContain('revoke all on function public.admin_merge_duplicate_identity_v1')
    expect(sql).toContain('to service_role')
  })
})
