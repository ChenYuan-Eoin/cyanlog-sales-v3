import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationDirectory = resolve(process.cwd(), 'supabase/migrations')
const tableMigrationName = '20260717061643_p0_fail_closed_contract_service_tables.sql'
const rpcMigrationName = '20260717062724_p0_restrict_privileged_contract_rpcs.sql'

const serviceTables = [
  'contract_items',
  'contract_signatures',
  'contract_drafts',
  'contract_template_params',
  'contract_risk_cards',
  'contract_ai_chats',
  'contract_comparisons',
  'comparison_diffs',
  'contract_rules_v2',
  'contract_rule_snapshots',
  'contract_risk_card_fixes',
] as const

function readMigration(name: string) {
  return readFileSync(resolve(migrationDirectory, name), 'utf8')
}

function withoutLineComments(sql: string) {
  return sql.replace(/--.*$/gm, '')
}

describe('P0 security migration contract', () => {
  it('keeps the table boundary before the privileged RPC boundary', () => {
    expect(tableMigrationName.localeCompare(rpcMigrationName)).toBeLessThan(0)
  })

  it('fails closed all eleven server-only tables without data mutation', () => {
    const sql = withoutLineComments(readMigration(tableMigrationName))

    for (const table of serviceTables) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`)
    }

    expect(sql).not.toMatch(/^\s*(insert|update|delete|truncate)\b/im)
    expect(sql).toContain('FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('TO service_role;')
    expect(sql).toContain("SET lock_timeout = '5s';")
    expect(sql).toContain("SET statement_timeout = '60s';")
    expect(sql).toContain('public_acl.grantee = 0')
    expect(sql).toContain("role_grant.grantee IN ('anon', 'authenticated')")
  })

  it('restricts both privileged SECURITY DEFINER RPCs to service_role', () => {
    const sql = withoutLineComments(readMigration(rpcMigrationName))

    expect(sql).not.toMatch(/^\s*(insert|update|delete|truncate)\b/im)
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.exec_sql(text)')
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.claim_contract_analysis_job(text, interval)',
    )
    expect(sql.match(/FROM PUBLIC, anon, authenticated;/g)).toHaveLength(2)
    expect(sql.match(/TO service_role;/g)).toHaveLength(2)
    expect(sql).toContain("has_function_privilege('anon', function_catalog.oid, 'EXECUTE')")
    expect(sql).toContain(
      "has_function_privilege('authenticated', function_catalog.oid, 'EXECUTE')",
    )
    expect(sql).toContain(
      "NOT has_function_privilege('service_role', function_catalog.oid, 'EXECUTE')",
    )
  })

  it('resets bounded migration timeouts in both files', () => {
    for (const name of [tableMigrationName, rpcMigrationName]) {
      const sql = readMigration(name)

      expect(sql).toContain("SET lock_timeout = '5s';")
      expect(sql).toContain("SET statement_timeout = '60s';")
      expect(sql).toContain('RESET statement_timeout;')
      expect(sql).toContain('RESET lock_timeout;')
    }
  })
})
