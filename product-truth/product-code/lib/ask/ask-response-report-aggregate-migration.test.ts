import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260721243000_wp04_ask_response_report_aggregate.sql'
  ),
  'utf8',
)
const submitResponse = readFileSync(
  join(process.cwd(), 'lib/ask/submit-response.ts'),
  'utf8',
)
const reportVersion = readFileSync(
  join(process.cwd(), 'lib/ask/report-version.ts'),
  'utf8',
)
const canary = readFileSync(
  join(process.cwd(), 'lib/ask/canaries/wp04-ask-response-report-aggregate.sql'),
  'utf8',
)

describe('WP04 ASK response/report aggregate migration', () => {
  it('publishes one service-only transaction RPC', () => {
    expect(migration.trimStart()).toContain('begin;')
    expect(migration).toContain("set local lock_timeout = '5s'")
    expect(migration).toContain('submit_ask_response_report_aggregate')
    expect(migration).toContain('security invoker')
    expect(migration).not.toContain('security definer')
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
    expect(migration.trimEnd().endsWith('commit;')).toBe(true)
  })

  it('locks current source and ReviewRun before the ASK and report rows', () => {
    const contractLock = migration.indexOf('from public.contracts as contract')
    const versionLock = migration.indexOf('from public.contract_versions as version')
    const reviewLock = migration.indexOf('from public.contract_reviews as review')
    const askLock = migration.indexOf('from public.ask_items as ask')
    const reportLock = migration.indexOf('from public.report_versions as report')

    expect(contractLock).toBeGreaterThan(0)
    expect(versionLock).toBeGreaterThan(contractLock)
    expect(reviewLock).toBeGreaterThan(versionLock)
    expect(askLock).toBeGreaterThan(reviewLock)
    expect(reportLock).toBeGreaterThan(askLock)
    expect(migration).toContain("version.ingest_status = 'SOURCE_READY'")
    expect(migration).toContain("not in ('COMPLETED', 'DEGRADED')")
    expect(migration).toContain('contract_source_page_maps')
  })

  it('writes response, ASK state, audits and report rollover without a partial-success branch', () => {
    expect(migration).toContain('insert into public.ask_responses')
    expect(migration).toContain('update public.ask_items as ask')
    expect(migration).toContain("'responded',")
    expect(migration).toContain("'report_generated',")
    expect(migration).toContain('order by report.version desc')
    expect(migration).toContain('for update;')
    expect(migration).toContain('set is_current = false')
    expect(migration).toContain('insert into public.report_versions')
    expect(migration).toContain('v_next_report_version')
    expect(migration).toContain("'ask_items', coalesce(")
    expect(migration).toContain("'response', case")

    expect(submitResponse).toContain(".rpc('submit_ask_response_report_aggregate'")
    expect(submitResponse).toContain('本次回应和报告均未写入')
    expect(submitResponse).not.toContain(".from('ask_responses')")
    expect(submitResponse).not.toContain('createAskResponseReportVersion')
    expect(reportVersion).not.toContain(".from('report_versions')")
  })

  it('ships a self-contained rollback canary that forces report failure', () => {
    expect(canary.trimStart()).toContain('begin;')
    expect(canary).toContain('wp04_canary_fail_ask_report')
    expect(canary).toContain('forced report publication failure')
    expect(canary).toContain('response leaked after forced report failure')
    expect(canary).toContain('report snapshot does not contain the committed response')
    expect(canary).toContain('rollback;')
    expect(canary).toContain("'fixture_rows_after_rollback', count(*)")
  })
})
