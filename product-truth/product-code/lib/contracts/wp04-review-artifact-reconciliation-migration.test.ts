import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260721238000_wp04_review_artifact_reconciliation.sql',
), 'utf8')

const canary = readFileSync(join(
  process.cwd(),
  'lib/contracts/canaries/wp04-review-artifact-reconciliation-canary.sql',
), 'utf8')

describe('WP04 review artifact forward reconciliation', () => {
  it('runs after the unsafe backfill and before the current-review ASK guard', () => {
    expect(migration).toContain('230000 added ReviewRun identity')
    expect(migration).toContain('before 239000 adds the current-review')
    expect(Number('20260721230000')).toBeLessThan(Number('20260721238000'))
    expect(Number('20260721238000')).toBeLessThan(Number('20260721239000'))
  })

  it('counts every ReviewRun before accepting a singleton legacy owner', () => {
    expect(migration).toContain('count(*)::integer as all_reviews')
    expect(migration).toContain(')::integer as bound_reviews')
    expect(migration.match(/counts\.all_reviews > 1/g)).toHaveLength(2)
    expect(migration.match(/counts\.bound_reviews = 1/g)).toHaveLength(2)
    expect(migration).toContain('update public.report_versions as report')
    expect(migration).toContain('update public.ask_items as ask')
    expect(migration).toMatch(
      /update public\.report_versions as report[\s\S]*?binding_state = 'legacy_unbound'/,
    )
    expect(migration).toMatch(
      /update public\.ask_items as ask[\s\S]*?binding_state = 'legacy_unbound'/,
    )
  })

  it('only releases rows owned by the sole version-bound review', () => {
    for (const alias of ['report', 'ask']) {
      expect(migration).toContain(`${alias}.review_id = counts.sole_bound_review_id`)
      expect(migration).toContain(`${alias}.contract_version_id = counts.sole_bound_version_id`)
      expect(migration).toContain(`${alias}.binding_state = 'bound'`)
    }
  })

  it('detaches human annotations before generated clauses can cascade-delete them', () => {
    const detach = migration.indexOf('update public.contract_annotations as annotation')
    const generatedDelete = migration.indexOf('delete from public.contract_annotations as annotation')
    const clauseDelete = migration.indexOf('delete from public.contract_clauses where review_id = p_review_id')

    expect(detach).toBeGreaterThan(-1)
    expect(detach).toBeLessThan(generatedDelete)
    expect(generatedDelete).toBeLessThan(clauseDelete)
    expect(migration).toContain('set clause_id = null')
    expect(migration).toContain("annotation.category is distinct from 'risk_finding'")
    expect(migration).toContain('or annotation.author_id is not null')
  })

  it('detaches historical cross-binding references before enforcing identity', () => {
    const annotationDetach = migration.indexOf(
      'update public.contract_annotations as annotation',
    )
    const reportDetach = migration.indexOf('set trigger_ask_id = null')
    const bindingFunction = migration.indexOf(
      'create or replace function public.enforce_review_artifact_binding()',
    )

    expect(annotationDetach).toBeGreaterThan(-1)
    expect(reportDetach).toBeGreaterThan(-1)
    expect(annotationDetach).toBeLessThan(bindingFunction)
    expect(reportDetach).toBeLessThan(bindingFunction)
    expect(migration).toContain('clause.contract_id = annotation.contract_id')
    expect(migration).toContain('clause.review_id = annotation.review_id')
    expect(migration).toContain('ask.contract_id = report.contract_id')
    expect(migration).toContain('ask.review_id = report.review_id')
    expect(migration).toContain('ask.contract_version_id = report.contract_version_id')
  })

  it('guards clause and trigger ASK changes with review-scoped references', () => {
    expect(migration).toContain(
      'annotation clause must belong to the same contract and ReviewRun',
    )
    expect(migration).toContain(
      'report trigger ASK must share the bound contract, ReviewRun and source version',
    )
    expect(migration).toMatch(
      /trg_contract_annotations_review_binding[\s\S]*update of[\s\S]*clause_id/,
    )
    expect(migration).toMatch(
      /trg_report_versions_review_binding[\s\S]*update of[\s\S]*trigger_ask_id/,
    )
    expect(migration).toContain("ask.binding_state = 'bound'")
  })

  it('rejects manual payload rows and replaces generated annotations only', () => {
    expect(migration).toContain(
      'analysis publication accepts only generated risk_finding annotations',
    )
    expect(migration).toContain("annotation.category = 'risk_finding'")
    expect(migration).toContain('and annotation.author_id is null')
    expect(migration).toContain("where row.category = 'risk_finding'")
    expect(migration).toContain('and row.author_id is null')
    expect(migration).not.toMatch(
      /delete from public\.contract_annotations\s+where contract_id = p_contract_id/,
    )
  })

  it('preserves the security-definer RPC boundary', () => {
    expect(migration).toContain('security definer')
    expect(migration).toContain("set search_path = ''")
    expect(migration).toContain(
      ') from public, anon, authenticated;\ngrant execute on function public.publish_contract_analysis_artifacts_fenced(',
    )
    expect(migration).toContain(') to service_role;')
  })

  it('ships a Preview-only rollback canary for both regressions', () => {
    expect(canary).toContain('WP04 Preview-only review artifact reconciliation canary')
    expect(canary).toContain('all_reviews > 1')
    expect(canary).toContain('trigger_ask_id = null')
    expect(canary).toContain('wp04_artifact_reconciliation_baseline')
    expect(canary).toContain("'preview_candidates_before_fixture'")
    expect(canary).not.toContain(
      "'preview_reconciliation_candidates_before_fixture', 0",
    )
    expect(canary).toContain('cross-binding report trigger ASK unexpectedly succeeded')
    expect(canary).toContain('cross-ReviewRun annotation clause unexpectedly succeeded')
    expect(canary).toContain('manual annotation was cascade-deleted')
    expect(canary).toContain('generated annotation replacement failed')
    expect(canary).toContain("'rolled_back', true")
    expect(canary.trimEnd()).toMatch(/rollback;$/)
  })
})
