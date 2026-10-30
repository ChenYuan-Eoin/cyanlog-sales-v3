import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261029110000_admin_fxiaoke_identity_binding.sql'),
  'utf8',
)
const fixSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261030110000_fix_fxiaoke_identity_binding_uuid.sql'),
  'utf8',
)

describe('administrator Fxiaoke identity binding migration', () => {
  it('requires an active exact-organization SUPER_ADMIN and an active target member', () => {
    expect(sql).toContain("role.code = 'SUPER_ADMIN'")
    expect(sql).toContain('identity binding target must be an active tenant member')
    expect(sql).toContain('membership.status = \'active\'')
  })

  it('binds only an explicit subject without phone or name matching', () => {
    expect(sql).toContain('p_external_subject')
    expect(sql).toContain('match_method,')
    expect(sql).toContain("'manual'")
    expect(sql).not.toMatch(/phone\s*=\s*p_/i)
    expect(sql).not.toMatch(/display_name\s*=\s*p_/i)
  })

  it('marks the configured Fxiaoke source as the active identity authority', () => {
    expect(sql).toContain("'active',")
    expect(sql).toContain("'identity', 'authoritative'")
    expect(sql).toContain("'organization', 'evidence'")
    expect(sql).toContain("authority_scope = authority_scope || jsonb_build_object")
  })

  it('uses the existing source and identity ledger and records an audit event', () => {
    expect(sql).toContain('public.organization_sources')
    expect(sql).toContain('public.external_identities')
    expect(sql).toContain('bind_external_identity')
    expect(sql).toContain('private.personnel_insert_event_v1')
    expect(sql).toContain('grant execute on function public.admin_bind_fxiaoke_identity_v1')
    expect(sql).toContain('to service_role')
  })

  it('repairs UUID source selection without unsupported min(uuid)', () => {
    expect(fixSql).not.toMatch(/min\s*\(\s*id\s*\)/i)
    expect(fixSql).toContain('select count(*)')
    expect(fixSql).toContain('select id')
    expect(fixSql).toContain('private.personnel_lock_org_v1(p_org_id)')
    expect(fixSql).toContain('admin_bind_fxiaoke_identity_v1')
    expect(fixSql).toContain('grant execute on function public.admin_bind_fxiaoke_identity_v1')
  })
})
