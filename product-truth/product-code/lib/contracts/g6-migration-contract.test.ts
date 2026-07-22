import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationDirectory = resolve(process.cwd(), 'supabase/migrations')
const migrationName = '20260718070000_g6_freeze_contract_comparison_sources.sql'
const migrationPath = resolve(migrationDirectory, migrationName)
const repairMigrationName = '20260718071000_repair_g6_frozen_bytes_and_diff_immutability.sql'
const repairMigrationPath = resolve(migrationDirectory, repairMigrationName)
const membershipMigrationName = '20260718072000_fix_g6_comparison_creator_membership.sql'
const membershipMigrationPath = resolve(migrationDirectory, membershipMigrationName)

function readMigration() {
  return readFileSync(migrationPath, 'utf8')
}

function readRepairMigration() {
  return readFileSync(repairMigrationPath, 'utf8')
}

function readMembershipMigration() {
  return readFileSync(membershipMigrationPath, 'utf8')
}

function withoutLineComments(sql: string) {
  return sql.replace(/--.*$/gm, '')
}

function rpcBody(sql: string) {
  const start = sql.indexOf('create function public.create_contract_comparison_v1(')
  const end = sql.indexOf(
    'revoke all on function public.create_contract_comparison_v1(',
    start,
  )
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end)
}

function normalizedFunctionDefinition(sql: string, name: string) {
  const plainMarker = `create function public.${name}(`
  const repairMarker = `create or replace function public.${name}(`
  const plainStart = sql.indexOf(plainMarker)
  const repairStart = sql.indexOf(repairMarker)
  const start = repairStart >= 0 ? repairStart : plainStart
  const endMarker = '\n$function$;'
  const end = sql.indexOf(endMarker, start)

  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return sql
    .slice(start, end + endMarker.length)
    .replace(/^create or replace function/, 'create function')
}

describe('G6 immutable comparison source migration contract', () => {
  it('is a bounded forward migration after the G5 source-fence prerequisite', () => {
    const sql = withoutLineComments(readMigration()).trim()

    expect('20260717202000_fence_contract_page_map_source.sql'.localeCompare(migrationName))
      .toBeLessThan(0)
    expect('20260718069000_fix_empty_matched_level_coalesce.sql'.localeCompare(migrationName))
      .toBeLessThan(0)
    expect(sql.startsWith('begin;')).toBe(true)
    expect(sql.endsWith('commit;')).toBe(true)
    expect(sql).toContain("set local lock_timeout = '5s';")
    expect(sql).toContain("set local statement_timeout = '60s';")
    expect(sql).toContain("to_regprocedure('public.contract_utf16_codeunit_length(text)')")
    expect(sql).toContain("to_regprocedure('public.contract_utf16_slice(text,integer,integer)')")
    expect(sql).not.toContain('contract_versions')
  })

  it('keeps every historical comparison legacy/unverified instead of backfilling it', () => {
    const sql = withoutLineComments(readMigration())
    const beforeRpc = sql.slice(
      0,
      sql.indexOf('create function public.create_contract_comparison_v1('),
    )

    expect(sql).toContain('add column org_id uuid references public.organizations(id) on delete restrict')
    expect(sql).toContain('add column source_snapshot_version smallint not null default 0')
    expect(sql).toContain('(source_snapshot_version = 0 and org_id is null)')
    expect(sql).toContain('(source_snapshot_version = 1 and org_id is not null)')
    expect(beforeRpc).not.toMatch(/^\s*(insert|update|delete|truncate)\b/im)
    expect(sql).toContain('G6 migration rewrote a legacy comparison as version 1')
    expect(sql).toContain('trg_contract_comparisons_require_v1_insert')
    expect(sql).toContain('G6_LEGACY_COMPARISON_INSERT_FORBIDDEN')
    expect(sql).toContain('trg_contract_comparisons_freeze_v1_identity')
    expect(sql).toContain('G6_COMPARISON_IDENTITY_IMMUTABLE')
    expect(sql).toContain('old.baseline_doc_id is distinct from new.baseline_doc_id')
  })

  it('defines exactly one old and one new immutable source with complete identity', () => {
    const sql = withoutLineComments(readMigration())
    const requiredColumns = [
      'org_id uuid not null',
      'comparison_id uuid not null',
      'contract_id uuid not null',
      'origin_storage_path text not null',
      'storage_path text not null',
      'file_name text not null',
      'file_size bigint not null',
      'mime_type text not null',
      'file_sha256 text not null',
      'text_sha256 text not null',
      'parsed_text text not null',
      'text_reliability text not null',
      'render_mode text not null',
      'page_map jsonb not null',
      'captured_at timestamptz not null',
    ]

    expect(sql).toContain('create table public.contract_comparison_sources (')
    for (const column of requiredColumns) expect(sql).toContain(column)
    expect(sql).toContain("check (role in ('old', 'new'))")
    expect(sql).toContain('unique (comparison_id, role)')
    expect(sql).toContain('unique (storage_path)')
    expect(sql).toContain('references public.contract_comparisons(id) on delete cascade')
    expect(sql).toContain('references public.contracts(id) on delete restrict')
    expect(sql).toContain("file_sha256 ~ '^[0-9a-f]{64}$'")
    expect(sql).toContain("text_sha256 ~ '^[0-9a-f]{64}$'")
    expect(sql).toContain("text_reliability = 'verified'")
    expect(sql).toContain("text_reliability = 'unavailable'")
    expect(sql).toContain("extensions.digest(pg_catalog.convert_to(parsed_text, 'UTF8'), 'sha256')")
    expect(sql).toContain("render_mode in ('native-pdf', 'docx-to-pdf', 'word-to-pdf', 'browser-ooxml')")
    expect(sql).toContain("pg_catalog.jsonb_typeof(page_map) = 'array'")
    expect(sql).toContain('idx_contract_comparison_sources_org_captured')
    expect(sql).toContain('idx_contract_comparison_sources_contract')
  })

  it('fails closed at the table, trigger, and deferred pair boundaries', () => {
    const sql = withoutLineComments(readMigration())

    expect(sql).toContain('alter table public.contract_comparison_sources enable row level security;')
    expect(sql).toContain('from public, anon, authenticated, service_role;')
    expect(sql).toContain('grant select on table public.contract_comparison_sources to service_role;')
    expect(sql).toContain('G6_COMPARISON_SOURCE_FROZEN_PATH_INVALID')
    expect(sql).toContain('before update or delete on public.contract_comparison_sources')
    expect(sql).toContain('G6_COMPARISON_SOURCE_IMMUTABLE')
    expect(sql).toContain('trg_contract_comparison_sources_validate_insert')
    expect(sql).toContain('G6_COMPARISON_SOURCE_CURRENT_IDENTITY_MISMATCH')
    expect(sql).toContain('new.origin_storage_path')
    expect(sql).toContain('G6_COMPARISON_DIFF_IMMUTABLE')
    expect(sql).toContain('trg_comparison_diffs_guard_v1_mutation')
    expect(sql).toContain('trg_contract_comparisons_reject_v1_delete')
    expect(sql).toContain('create constraint trigger trg_contract_comparisons_require_v1_source_pair')
    expect(sql).toContain('deferrable initially deferred')
    expect(sql).toContain('G6_COMPARISON_REQUIRES_EXACT_OLD_NEW_PAIR')
    expect(sql).toContain("pg_catalog.has_table_privilege('anon', source_table_oid, 'SELECT')")
    expect(sql).toContain("pg_catalog.has_table_privilege('service_role', source_table_oid, 'UPDATE')")
  })

  it('creates version 1 plus both sources, positioned diffs, and completion in one RPC statement', () => {
    const sql = withoutLineComments(readMigration())
    const rpc = rpcBody(sql)
    const comparisonInsert = rpc.indexOf('insert into public.contract_comparisons (')
    const sourcesInsert = rpc.indexOf('insert into public.contract_comparison_sources (')
    const diffsInsert = rpc.indexOf('insert into public.comparison_diffs (')
    const completionUpdate = rpc.indexOf('update public.contract_comparisons')
    const returnComparison = rpc.indexOf('return comparison_id;')

    expect(rpc).toContain('security definer')
    expect(rpc).toContain("set search_path = ''")
    expect(rpc).toContain('G6_COMPARISON_CREATOR_ORG_MISMATCH')
    expect(rpc).toContain('join public.user_organizations as membership')
    expect(rpc).toContain('membership.user_id = creator.id')
    expect(rpc).toContain('membership.org_id = p_org_id')
    expect(rpc).toContain("creator.status = 'active'")
    expect(rpc).not.toContain('creator.org_id = p_org_id')
    expect(rpc).not.toContain('membership.is_default')
    expect(rpc).toContain('G6_COMPARISON_REQUIRES_DISTINCT_SOURCE_CONTRACTS')
    expect(rpc).toContain('G6_COMPARISON_UNREADABLE_SOURCE_CANNOT_HAVE_DIFFS')
    expect(rpc).toContain('G6_COMPARISON_DIFF_INCOMPLETE')
    expect(rpc).toContain('G6_COMPARISON_DIFF_TYPE_TEXT_MISMATCH')
    expect(rpc).toContain('G6_COMPARISON_DIFF_')
    expect(rpc).toContain('_PAGE_RANGE_MISMATCH')
    expect(rpc).toContain('_TEXT_RANGE_MISMATCH')
    expect(rpc).toContain('public.contract_utf16_codeunit_length(')
    expect(rpc).toContain('public.contract_utf16_slice(')
    expect(rpc).toContain("not like 'g6-frozen/' || p_org_id::text || '/%'")
    expect(rpc).toContain("p_old_source->>'text_reliability' <> 'verified'")
    expect(rpc).not.toContain('position_end > pg_catalog.char_length(')
    expect(rpc).toContain('source_snapshot_version,')
    expect(rpc).toContain("'processing'")
    expect(rpc).toContain('set status = case')
    expect(rpc).toContain("else 'completed'")
    expect(rpc).toContain("then 'failed'")
    expect(rpc).toContain('then p_ai_summary')
    expect(rpc).toContain('G6_COMPARISON_FINALIZATION_FAILED')
    expect(comparisonInsert).toBeGreaterThan(0)
    expect(sourcesInsert).toBeGreaterThan(comparisonInsert)
    expect(diffsInsert).toBeGreaterThan(sourcesInsert)
    expect(completionUpdate).toBeGreaterThan(diffsInsert)
    expect(returnComparison).toBeGreaterThan(completionUpdate)
    expect(rpc).not.toMatch(/exception\s+when/i)
  })

  it('keeps the SECURITY DEFINER RPC service-role-only', () => {
    const sql = withoutLineComments(readMigration())
    const signature = 'public.create_contract_comparison_v1(\n  uuid, uuid, text, jsonb, jsonb, jsonb, text, text\n)'

    expect(sql).toContain(`revoke all on function ${signature} from public, anon, authenticated;`)
    expect(sql).toContain(`grant execute on function ${signature} to service_role;`)
    expect(sql).toContain("'public.create_contract_comparison_v1(uuid,uuid,text,jsonb,jsonb,jsonb,text,text)'")
    expect(sql).toContain('G6 comparison creation RPC ACL postcondition failed')
  })
})

describe('G6 frozen-byte and immutable-diff forward repair contract', () => {
  it('is a bounded zero-data repair that also follows a clean final 070000 migration', () => {
    const sql = withoutLineComments(readRepairMigration()).trim()

    expect(migrationName.localeCompare(repairMigrationName)).toBeLessThan(0)
    expect(sql.startsWith('begin;')).toBe(true)
    expect(sql.endsWith('commit;')).toBe(true)
    expect(sql).toContain("set local lock_timeout = '5s';")
    expect(sql).toContain("set local statement_timeout = '60s';")
    expect(sql).toContain("to_regclass('public.contract_comparison_sources')")
    expect(sql).toContain('G6 repair requires zero source snapshots')
    expect(sql).toContain('G6 repair requires zero version-1 comparisons')
    expect(sql).toContain('add column if not exists origin_storage_path text')
    expect(sql).toContain('add column if not exists text_reliability text')
    expect(sql).toContain('alter column origin_storage_path set not null')
    expect(sql).toContain('alter column text_reliability set not null')
    expect(sql).toContain('drop constraint if exists contract_comparison_sources_storage_path_check')
    expect(sql).toContain('drop constraint if exists contract_comparison_sources_frozen_path_key')
    expect(sql).not.toMatch(/\bdrop\s+table\b/i)
    expect(sql).not.toMatch(/\bdrop\s+column\b/i)
    expect(sql).not.toMatch(/\btruncate\b/i)
  })

  it('replaces every affected function with the exact final clean-baseline definition', () => {
    const baseline = withoutLineComments(readMigration())
    const repair = withoutLineComments(readRepairMigration())
    const functionNames = [
      'freeze_contract_comparison_v1_identity',
      'reject_contract_comparison_v1_delete',
      'guard_contract_comparison_diff_v1_mutation',
      'validate_contract_comparison_source_insert_v1',
      'create_contract_comparison_v1',
    ]

    for (const name of functionNames) {
      expect(normalizedFunctionDefinition(repair, name))
        .toBe(normalizedFunctionDefinition(baseline, name))
    }

    const rpc = normalizedFunctionDefinition(repair, 'create_contract_comparison_v1')
    expect(rpc).toContain('public.contract_utf16_codeunit_length(')
    expect(rpc).toContain('public.contract_utf16_slice(')
    expect(rpc).not.toContain('pg_catalog.greatest')
    expect(rpc).not.toContain('pg_catalog.char_length')
  })

  it('freezes byte paths and text reliability with validated unique/check constraints', () => {
    const sql = withoutLineComments(readRepairMigration())

    expect(sql).toContain('contract_comparison_sources_storage_path_check')
    expect(sql).toContain("pg_catalog.btrim(origin_storage_path) <> ''")
    expect(sql).toContain("pg_catalog.btrim(storage_path) <> ''")
    expect(sql).toContain('storage_path <> origin_storage_path')
    expect(sql).toContain('contract_comparison_sources_frozen_path_key')
    expect(sql).toContain('unique (storage_path)')
    expect(sql).toContain('contract_comparison_sources_text_reliability_check')
    expect(sql).toContain("text_reliability = 'verified'")
    expect(sql).toContain("text_reliability = 'unavailable'")
    expect(sql).toContain('constraint_row.convalidated')
  })

  it('installs v1 parent/diff guards and reasserts service-only source/RPC access', () => {
    const sql = withoutLineComments(readRepairMigration())

    expect(sql).toContain('drop trigger if exists trg_contract_comparisons_reject_v1_delete')
    expect(sql).toContain('before delete on public.contract_comparisons')
    expect(sql).toContain('G6_COMPARISON_IMMUTABLE')
    expect(sql).toContain('drop trigger if exists trg_comparison_diffs_guard_v1_mutation')
    expect(sql).toContain('before insert or update or delete on public.comparison_diffs')
    expect(sql).toContain('G6_COMPARISON_DIFF_IMMUTABLE')
    expect(sql).toContain('drop trigger if exists trg_contract_comparison_sources_validate_insert')
    expect(sql).toContain('drop trigger if exists trg_contract_comparisons_freeze_v1_identity')
    expect(sql).toContain('alter table public.contract_comparison_sources enable row level security;')
    expect(sql).toContain('from public, anon, authenticated, service_role;')
    expect(sql).toContain('grant select on table public.contract_comparison_sources to service_role;')
    expect(sql).toContain('G6_COMPARISON_SOURCE_FROZEN_PATH_INVALID')
    expect(sql).toContain("or pg_catalog.has_table_privilege('service_role', source_table_oid, 'INSERT')")
    expect(sql).not.toContain("or not pg_catalog.has_table_privilege('service_role', source_table_oid, 'INSERT')")
    expect(sql).toContain("has_table_privilege('service_role', source_table_oid, 'UPDATE')")
    expect(sql).toContain("has_table_privilege('service_role', source_table_oid, 'DELETE')")
    expect(sql).toContain('revoke all on function public.create_contract_comparison_v1(')
    expect(sql).toContain(') from public, anon, authenticated;')
    expect(sql).toContain(') to service_role;')
    expect(sql).toContain('G6 repair postcondition failed; creation RPC ACL is unsafe')
  })

  it('rejects moving a legacy diff onto a v1 comparison through UPDATE', () => {
    const repair = withoutLineComments(readRepairMigration())
    const guard = normalizedFunctionDefinition(
      repair,
      'guard_contract_comparison_diff_v1_mutation',
    )

    expect(guard).toContain("if tg_op = 'UPDATE' and exists (")
    expect(guard).toContain('comparison.id in (old.comparison_id, new.comparison_id)')
    expect(guard).toContain('comparison.source_snapshot_version = 1')
    expect(guard).toContain("if tg_op <> 'UPDATE' and found and parent_version = 1")
  })
})

describe('G6 comparison creator membership forward repair contract', () => {
  it('is a bounded metadata-only forward migration after the frozen-byte repair', () => {
    const sql = withoutLineComments(readMembershipMigration()).trim()
    const rpcStart = sql.indexOf(
      'create or replace function public.create_contract_comparison_v1(',
    )
    const rpcEnd = sql.indexOf('\n$function$;', rpcStart) + '\n$function$;'.length
    const outsideRpc = `${sql.slice(0, rpcStart)}${sql.slice(rpcEnd)}`

    expect(repairMigrationName.localeCompare(membershipMigrationName)).toBeLessThan(0)
    expect(sql.startsWith('begin;')).toBe(true)
    expect(sql.endsWith('commit;')).toBe(true)
    expect(sql).toContain("set local lock_timeout = '5s';")
    expect(sql).toContain("set local statement_timeout = '60s';")
    expect(sql).toContain("to_regclass('public.users')")
    expect(sql).toContain("to_regclass('public.user_organizations')")
    expect(sql).toContain("to_regprocedure(\n    'public.create_contract_comparison_v1(uuid,uuid,text,jsonb,jsonb,jsonb,text,text)'\n  )")
    expect(rpcStart).toBeGreaterThan(0)
    expect(rpcEnd).toBeGreaterThan(rpcStart)
    expect(outsideRpc).not.toMatch(/^\s*(insert|update|delete|truncate)\b/im)
    expect(sql).not.toMatch(/\bdrop\s+(table|column|function)\b/i)
  })

  it('carries the complete RPC definition with exact clean-install and repair parity', () => {
    const baseline = withoutLineComments(readMigration())
    const repair = withoutLineComments(readRepairMigration())
    const membership = withoutLineComments(readMembershipMigration())
    const finalDefinition = normalizedFunctionDefinition(
      membership,
      'create_contract_comparison_v1',
    )

    expect(finalDefinition).toBe(
      normalizedFunctionDefinition(baseline, 'create_contract_comparison_v1'),
    )
    expect(finalDefinition).toBe(
      normalizedFunctionDefinition(repair, 'create_contract_comparison_v1'),
    )
    expect(membership.match(/create or replace function public\.create_contract_comparison_v1\(/g))
      .toHaveLength(1)
    expect(membership).not.toMatch(/replace\s*\(\s*pg_catalog\.pg_get_functiondef/i)
  })

  it('accepts any explicit organization membership while keeping active-user and ACL gates', () => {
    const sql = withoutLineComments(readMembershipMigration())
    const rpc = normalizedFunctionDefinition(sql, 'create_contract_comparison_v1')

    expect(rpc).toContain('join public.user_organizations as membership')
    expect(rpc).toContain('membership.user_id = creator.id')
    expect(rpc).toContain('membership.org_id = p_org_id')
    expect(rpc).toContain("creator.status = 'active'")
    expect(rpc).not.toContain('creator.org_id = p_org_id')
    expect(rpc).not.toContain('membership.is_default')
    expect(sql).toContain('G6 creator membership repair postcondition failed; creator membership semantics are unsafe')
    expect(sql).toContain('G6 creator membership repair postcondition failed; comparison RPC ACL is unsafe')
    expect(sql).toContain('revoke all on function public.create_contract_comparison_v1(')
    expect(sql).toContain(') from public, anon, authenticated;')
    expect(sql).toContain(') to service_role;')
  })
})
