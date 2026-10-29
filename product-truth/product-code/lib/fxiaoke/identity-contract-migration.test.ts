import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261029090000_fxiaoke_sso_identity.sql'),
  'utf8',
)

describe('Fxiaoke identity contract migration', () => {
  it('keeps one stable subject and one canonical user per organization source', () => {
    expect(sql).toContain('external_identities_source_canonical_unique')
    expect(sql).toContain("where match_status = 'matched' and canonical_user_id is not null")
    expect(sql).toMatch(/external_identities \(source_id, canonical_user_id\)/)
  })

  it('uses a PostgreSQL exclusion constraint for tenant-scoped phone intervals', () => {
    expect(sql).toContain('create extension if not exists btree_gist')
    expect(sql).toContain('phone_history_no_overlap_excl')
    expect(sql).toContain('exclude using gist')
    expect(sql).toContain('org_id with =')
    expect(sql).toContain('phone with =')
    expect(sql).toContain("tstzrange(valid_from, valid_to, '[)') with &&")
    expect(sql).not.toContain('phone_history_no_overlap on public.phone_history')
  })

  it('does not introduce a special administrator identity matching path', () => {
    expect(sql).not.toContain('employee_number =')
    expect(sql).not.toContain('bootstrap_super_admin')
    expect(sql).not.toContain('owner_user_id')
  })
})
