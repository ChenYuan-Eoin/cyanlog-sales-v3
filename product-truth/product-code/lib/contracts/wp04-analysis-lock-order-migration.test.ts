import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260721241000_wp04_analysis_lock_order.sql',
), 'utf8')

const singleSessionCanary = readFileSync(join(
  process.cwd(),
  'lib/contracts/canaries/wp04-analysis-lock-order-canary.sql',
), 'utf8')

const twoSessionCanary = readFileSync(join(
  process.cwd(),
  'lib/contracts/canaries/wp04-analysis-lock-order-two-session.mjs',
), 'utf8')

function functionBody(qualifiedName: string) {
  const start = migration.indexOf(`create or replace function ${qualifiedName}(`)
  expect(start).toBeGreaterThan(-1)
  const end = migration.indexOf('\nrevoke all on function', start)
  expect(end).toBeGreaterThan(start)
  return migration.slice(start, end)
}

describe('WP04 analysis aggregate lock order', () => {
  it('lands after current-review mutation and before later WP04 aggregate repairs', () => {
    expect(Number('20260721239000')).toBeLessThan(Number('20260721241000'))
    expect(Number('20260721241000')).toBeLessThan(Number('20260721242000'))
  })

  it('guards every effective routine signature instead of creating overloads', () => {
    for (const signature of [
      'public.start_initial_contract_review(uuid,uuid,uuid,uuid,text,uuid)',
      'public.start_initial_contract_review_fenced(uuid,uuid,uuid,uuid,text,uuid,uuid,text)',
      'public.mark_contract_analysis_job_running(uuid,uuid,text)',
      'public.mark_contract_analysis_job_completed(uuid,uuid,text,boolean,jsonb)',
      'public.mark_contract_analysis_job_failed(uuid,uuid,text)',
      'public.publish_contract_analysis_artifacts_fenced(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,boolean,jsonb)',
    ]) {
      expect(migration).toContain(`'${signature}'`)
    }
    expect(migration).toContain(
      'start_initial_contract_review no longer follows contract-version-review-job order',
    )
  })

  it('discovers IDs without a row lock, then locks contract-version-review-job once', () => {
    const coordinator = functionBody('private.wp04_lock_analysis_chain')
    const discovery = coordinator.indexOf('from public.contract_analysis_jobs as job')
    const contract = coordinator.indexOf('-- LOCK ORDER 1/4: contract aggregate head.')
    const version = coordinator.indexOf('-- LOCK ORDER 2/4: immutable source version.')
    const review = coordinator.indexOf('-- LOCK ORDER 3/4: ReviewRun.')
    const job = coordinator.indexOf('-- LOCK ORDER 4/4: worker lease.')
    const firstForUpdate = coordinator.indexOf('for update;')

    expect(discovery).toBeGreaterThan(-1)
    expect(discovery).toBeLessThan(contract)
    expect(firstForUpdate).toBeGreaterThan(contract)
    expect(contract).toBeLessThan(version)
    expect(version).toBeLessThan(review)
    expect(review).toBeLessThan(job)
    expect(coordinator.slice(discovery, contract)).not.toContain('for update')
    expect(coordinator.slice(discovery, contract)).not.toContain('for share')
    expect(coordinator).toContain('current_contract.current_version_id is distinct from chain_contract_version_id')
    expect(coordinator).toContain("leased_job.status <> 'running'")
    expect(coordinator).toContain('leased_job.lock_token is distinct from p_lock_token')
  })

  it('makes the fenced start lock contract and version explicitly before the base start', () => {
    const fencedStart = functionBody('public.start_initial_contract_review_fenced')
    const contract = fencedStart.indexOf('-- LOCK ORDER 1/4: contract aggregate head.')
    const version = fencedStart.indexOf('-- LOCK ORDER 2/4: source version.')
    const delegatedStart = fencedStart.indexOf('from public.start_initial_contract_review(')

    expect(contract).toBeGreaterThan(-1)
    expect(contract).toBeLessThan(version)
    expect(version).toBeLessThan(delegatedStart)
    expect(fencedStart).not.toContain('for update of contract, version')
  })

  it('routes every worker and publisher through the coordinator before writes', () => {
    for (const name of [
      'public.mark_contract_analysis_job_running',
      'public.mark_contract_analysis_job_completed',
      'public.mark_contract_analysis_job_failed',
      'public.publish_contract_analysis_artifacts_fenced',
    ]) {
      const body = functionBody(name)
      const coordinator = body.indexOf('from private.wp04_lock_analysis_chain(')
      const firstWrite = Math.min(
        ...['update public.', 'delete from public.', 'insert into public.']
          .map((needle) => body.indexOf(needle))
          .filter((position) => position >= 0),
      )
      expect(coordinator).toBeGreaterThan(-1)
      expect(firstWrite).toBeGreaterThan(coordinator)
      expect(body.slice(0, coordinator)).not.toMatch(/for update|for share/)
    }
  })

  it('preserves 238000 human-annotation and generated-artifact behavior', () => {
    const publisher = functionBody('public.publish_contract_analysis_artifacts_fenced')
    const detach = publisher.indexOf('update public.contract_annotations as annotation')
    const generatedDelete = publisher.indexOf('delete from public.contract_annotations as annotation')
    const clauseDelete = publisher.indexOf('delete from public.contract_clauses where review_id = p_review_id')

    expect(detach).toBeGreaterThan(-1)
    expect(detach).toBeLessThan(generatedDelete)
    expect(generatedDelete).toBeLessThan(clauseDelete)
    expect(publisher).toContain('set clause_id = null')
    expect(publisher).toContain("annotation.category is distinct from 'risk_finding'")
    expect(publisher).toContain('or annotation.author_id is not null')
    expect(publisher).toContain("annotation.category = 'risk_finding'")
    expect(publisher).toContain('and annotation.author_id is null')
    expect(publisher).toContain('analysis publication accepts only generated risk_finding annotations')
  })

  it('keeps every public RPC security-definer and service-role only', () => {
    for (const name of [
      'start_initial_contract_review_fenced',
      'mark_contract_analysis_job_running',
      'mark_contract_analysis_job_completed',
      'mark_contract_analysis_job_failed',
      'publish_contract_analysis_artifacts_fenced',
    ]) {
      const body = functionBody(`public.${name}`)
      expect(body).toContain('security definer')
      expect(body).toContain("set search_path = ''")
      expect(migration).toContain(`grant execute on function public.${name}(`)
    }
    expect(migration).toContain(
      ') from public, anon, authenticated, service_role;',
    )
  })

  it('ships rollback and deterministic two-session proofs', () => {
    expect(singleSessionCanary).toContain('WP04 Preview-only single-session')
    expect(singleSessionCanary.match(/from public\.start_initial_contract_review_fenced\(/g)).toHaveLength(3)
    expect(singleSessionCanary).toContain('from public.claim_contract_analysis_job_by_id(')
    expect(singleSessionCanary).toContain('from public.mark_contract_analysis_job_running(')
    expect(singleSessionCanary).toContain('from public.publish_contract_analysis_artifacts_fenced(')
    expect(singleSessionCanary).toContain('review_count <> 1 or job_count <> 1')
    expect(singleSessionCanary).toContain("'final_state', 'COMPLETED'")
    expect(singleSessionCanary.trimEnd()).toMatch(/rollback;$/)

    expect(twoSessionCanary).toContain('WP04_PREVIEW_DATABASE_URL')
    expect(twoSessionCanary).toContain('pg_catalog.pg_locks')
    expect(twoSessionCanary).toContain('not granted')
    expect(twoSessionCanary).toContain('public.mark_contract_analysis_job_running')
    expect(twoSessionCanary).toContain('public.start_initial_contract_review(')
    expect(twoSessionCanary).toContain("deadlockSqlstate: null")
    expect(twoSessionCanary).toContain('review_count !== 1')
    expect(twoSessionCanary).toContain('job_count !== 1')
  })
})
