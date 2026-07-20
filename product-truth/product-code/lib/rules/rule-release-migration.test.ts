import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const initial = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260720053000_add_rule_test_evidence_and_ruleset_publish.sql'
), 'utf8')
const reconciliation = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260720054500_reconcile_ruleset_publish_function.sql'
), 'utf8')
const hardening = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260720063000_harden_rule_release_control_plane.sql'
), 'utf8')

describe('canonical ruleset release migration', () => {
  it('keeps test evidence server-only and binds new runs to immutable rule truth', () => {
    expect(initial).toContain('CREATE TABLE IF NOT EXISTS contract_rule_test_runs')
    expect(initial).toContain('ALTER TABLE contract_rule_test_runs ENABLE ROW LEVEL SECURITY')
    expect(initial).toContain('REVOKE ALL ON TABLE contract_rule_test_runs FROM anon, authenticated')
    expect(hardening).toContain('ADD COLUMN IF NOT EXISTS rule_snapshot_id UUID')
    expect(hardening).toContain('ADD COLUMN IF NOT EXISTS rule_contract_sha256 TEXT')
    expect(hardening).toContain('ADD COLUMN IF NOT EXISTS evaluator_revision TEXT')
    expect(hardening).toContain("test_run.evaluator_revision = 'rule-contract-v1-20260720'")
    expect(hardening).toContain('test_run.rule_snapshot_id = v_acceptance_snapshot_id')
    expect(hardening).toContain('test_run.rule_contract_sha256 = v_rule_contract_sha256')
    expect(hardening).toContain('CREATE OR REPLACE FUNCTION public.canonical_jsonb_text_v1')
    expect(hardening).toContain("convert_to(public.canonical_jsonb_text_v1(v_rule.rule_contract), 'UTF8')")
  })

  it('retains immutable published history and backfills one explicit current RuleSet pointer', () => {
    expect(hardening).toContain('ADD COLUMN IF NOT EXISTS current_snapshot_id UUID')
    expect(hardening).toContain('contract_rule_sets_current_snapshot_id_fkey')
    expect(hardening).toContain('CREATE OR REPLACE FUNCTION public.validate_contract_rule_set_current_snapshot_v1')
    expect(hardening).toContain("snapshot.status = 'published'")
    expect(hardening).toContain('WITH ranked_published AS')
    expect(hardening).toContain('PARTITION BY snapshot.org_id, snapshot.rule_set_id')
    expect(hardening).toContain('snapshot.released_at DESC NULLS LAST')
    expect(hardening).toContain('snapshot.created_at DESC')
    expect(hardening).toContain('snapshot.version DESC')
    expect(hardening).toContain('ranked.published_rank = 1')
    expect(hardening).toContain('UPDATE public.contract_rule_sets AS rule_set')
    expect(hardening).toContain('SET current_snapshot_id = ranked.id')
    expect(hardening).toContain('DROP INDEX IF EXISTS public.uq_contract_rule_set_snapshots_current_published')
    expect(hardening).not.toContain('ranked.published_rank > 1')
  })

  it('locks RuleSet before member Rule and allocates versions from immutable snapshots', () => {
    expect(hardening).toContain('shared control-plane lock order: RuleSet -> Rule')
    expect(hardening).toContain('Every control-plane mutation locks its actual RuleSet before any member Rule')
    expect(hardening).toContain('COALESCE(MAX(snapshot.version), 0),')
    expect(hardening).toContain('SELECT COALESCE(MAX(snapshot.version), 0) + 1')
    expect(hardening).toContain('FROM public.contract_rule_set_snapshots AS snapshot')
    expect(hardening).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_rule_snapshots_rule_version_status')
    expect(hardening).toContain('ON public.contract_rule_snapshots(rule_id, version, status)')
    expect(hardening).toContain("RAISE EXCEPTION 'RULE_DRAFT_VERSION_CONFLICT'")
    expect(hardening).toContain('Existing mutations use the full lock order RuleSet -> Rule -> Category')
  })

  it('takes the newest case/decision run before checking whether it passed', () => {
    expect(hardening).toContain("SELECT DISTINCT ON (test_run.case_kind, COALESCE(test_run.expected_decision_id, ''))")
    expect(hardening).toContain('test_run.created_at DESC,')
    expect(hardening).toContain('test_run.id DESC')
    expect(hardening).toContain('WHERE latest_run.assertion_passed = true')
    expect(hardening).not.toContain('AND test_run.assertion_passed = true')
    expect(hardening).toContain('Draft and unchanged published rules use one explicit acceptance source')
    expect(hardening).toContain('AND test_run.rule_snapshot_id = v_acceptance_snapshot_id')
    expect(hardening).toContain('AND test_run.rule_contract_sha256 = v_rule_contract_sha256')
    expect(hardening).not.toContain('v_previous_tests')
  })

  it('requires every decision plus missing, multi-value and money-currency cases', () => {
    expect(hardening).toContain('RULE_TEST_DECISION_MATRIX_MISSING')
    expect(hardening).toContain("test_run ->> 'expected_status' = 'decided'")
    expect(hardening).toContain('RULE_TEST_MISSING_EVIDENCE_MISSING')
    expect(hardening).toContain('RULE_TEST_VALUE_CONFLICT_MISSING')
    expect(hardening).toContain('RULE_TEST_UNIT_CONFLICT_MISSING')
    expect(hardening).toContain("property ->> 'type' <> 'text'")
    expect(hardening).toContain("property ->> 'type' <> 'enum'")
    expect(hardening).toContain("jsonb_array_length(COALESCE(property -> 'options', '[]'::jsonb)) >= 2")
    expect(hardening).toContain("property ->> 'type' = 'money'")
  })

  it('supports first publication and rebuilds evidence from final active membership', () => {
    expect(hardening).toContain("v_previous_document_ids UUID[] := ARRAY[]::UUID[]")
    expect(hardening).toContain("v_previous_document_ids := COALESCE(v_previous_document_ids, ARRAY[]::UUID[])")
    expect(hardening).toContain("v_test_results JSONB := '{}'::jsonb")
    expect(hardening).toContain('rule.is_active = false')
    expect(hardening).toContain("SET lifecycle_status = 'archived'")
  })

  it('publishes insert-only and switches only the RuleSet current pointer', () => {
    const publishFunction = hardening.slice(
      hardening.indexOf('CREATE OR REPLACE FUNCTION public.publish_contract_rule_set_v1'),
      hardening.indexOf('CREATE OR REPLACE FUNCTION public.update_contract_rule_problem_category_v1')
    )
    expect(publishFunction).toContain('v_acceptance_snapshot_id UUID')
    expect(publishFunction).toContain('snapshot.id = ANY(v_current_rule_snapshot_ids)')
    expect(publishFunction).toContain('INSERT INTO public.contract_rule_snapshots')
    expect(publishFunction).toContain("'accepted_draft_snapshot_id', snapshot.id")
    expect(publishFunction).toContain("AND snapshot.status = 'draft'")
    expect(publishFunction).toContain("'published'")
    expect(publishFunction).toContain('current_snapshot_id = v_set_snapshot_id')
    expect(publishFunction).not.toContain("SET status = 'published'")
    expect(publishFunction).not.toContain('UPDATE public.contract_rule_set_snapshots')
  })

  it('freezes member category meaning in the RuleSetSnapshot', () => {
    expect(hardening).toContain('v_problem_categories JSONB')
    expect(hardening).toContain("'id', category.id")
    expect(hardening).toContain("'code', category.code")
    expect(hardening).toContain("'name', category.name")
    expect(hardening).toContain("'description', category.description")
    expect(hardening).toContain("'problem_categories', v_problem_categories")
  })

  it('marks category semantic edits pending without mutating published snapshots', () => {
    expect(hardening).toContain('CREATE OR REPLACE FUNCTION public.update_contract_rule_problem_category_v1')
    expect(hardening).toContain('Category is the last lock in the control plane')
    expect(hardening).toContain("RAISE EXCEPTION 'RULE_CATEGORY_ACTIVE_REFERENCES'")
    expect(hardening).toContain("SET lifecycle_status = 'ready_to_publish', updated_at = v_now")
    expect(hardening).toContain('RuleSetSnapshots remain untouched')
    const categoryFunction = hardening.slice(
      hardening.indexOf('CREATE OR REPLACE FUNCTION public.update_contract_rule_problem_category_v1'),
      hardening.indexOf('REVOKE ALL ON FUNCTION public.save_contract_rule_draft_v1')
    )
    expect(categoryFunction).not.toContain('UPDATE public.contract_rule_set_snapshots')
  })

  it('leaves one function signature and grants only the server role', () => {
    expect(reconciliation).toContain('DROP FUNCTION IF EXISTS public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT, JSONB)')
    expect(reconciliation).toContain('ALTER FUNCTION public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT)')
    expect(hardening).toContain('REVOKE ALL ON FUNCTION public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT)')
    expect(hardening).toContain('GRANT EXECUTE ON FUNCTION public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT) TO service_role')
    expect(hardening).toContain('GRANT EXECUTE ON FUNCTION public.update_contract_rule_problem_category_v1(UUID, UUID, UUID, JSONB) TO service_role')
    expect(hardening).toContain('GRANT EXECUTE ON FUNCTION public.canonical_jsonb_text_v1(JSONB) TO service_role')
    expect(hardening).toContain('GRANT EXECUTE ON FUNCTION public.validate_contract_rule_set_current_snapshot_v1() TO service_role')
    expect(hardening).not.toContain('GRANT EXECUTE ON FUNCTION public.publish_contract_rule_set_v1(UUID, UUID, UUID, TEXT) TO authenticated')
  })
})
