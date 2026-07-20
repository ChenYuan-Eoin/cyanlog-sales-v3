import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260720060000_harden_rule_config_control_plane.sql'
  ),
  'utf8'
)

const serverOnlyTables = [
  'contract_rule_sets',
  'contract_rule_snapshots',
  'contract_rule_set_documents',
  'contract_rule_set_snapshots',
]

describe('rule configuration control-plane migration', () => {
  it.each(serverOnlyTables)('enables RLS for %s', (table) => {
    expect(migration).toContain(
      `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`
    )
  })

  it('revokes browser table access and keeps an explicit service-role allowlist', () => {
    expect(migration).toMatch(
      /REVOKE ALL PRIVILEGES ON TABLE[\s\S]*FROM PUBLIC, anon, authenticated;/
    )
    expect(migration).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE[\s\S]*TO service_role;/
    )
  })

  it('allows only service_role to execute the ruleset publication function', () => {
    const signature = 'public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT)'
    expect(migration).toContain(`REVOKE ALL PRIVILEGES ON FUNCTION ${signature}`)
    expect(migration).toContain('FROM PUBLIC, anon, authenticated, service_role;')
    expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${signature}`)
    expect(migration).toContain('TO service_role;')
    expect(migration).toContain('SET search_path = pg_catalog, public;')
  })
})
