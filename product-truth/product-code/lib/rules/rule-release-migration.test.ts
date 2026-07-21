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
const wp03Repair = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260721041818_quarantine_unconfirmed_rule_translations.sql'
), 'utf8')
const wp03PostApplyReconciliation = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260721051829_reconcile_wp03_quarantined_current_skill_bundles.sql'
), 'utf8')
const wp03CanaryCategoryReconciliation = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260721054500_archive_wp03_controlled_canary_category.sql'
), 'utf8')

describe('canonical ruleset release migration', () => {
  it('keeps the WP03 SQL structurally balanced before remote parsing', () => {
    expect(wp03Repair.split('\n').some((line) => line.trim() === '+')).toBe(false)
    expect((wp03Repair.match(/\$\$/g) || []).length % 2).toBe(0)
    expect(wp03Repair.match(/CREATE OR REPLACE FUNCTION public\.persist_contract_skill_bundle_v1/g)).toHaveLength(1)
    expect(wp03Repair.match(/CREATE OR REPLACE FUNCTION public\.publish_contract_rule_set_v1/g)).toHaveLength(1)
    expect(wp03Repair.match(/GRANT EXECUTE ON FUNCTION public\.persist_contract_skill_bundle_v1/g)).toHaveLength(1)
  })

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

  it('quarantines unconfirmed translations without rewriting published history', () => {
    expect(wp03Repair).toContain("'STANDARD_SALES_CONTRACT_REVIEW'")
    expect(wp03Repair).toContain("'canonical_rule_contract_confirmation'")
    expect(wp03Repair).toContain("'legacy_adapter_publish_forbidden', true")
    expect(wp03Repair).toContain("'draft'")
    expect(wp03Repair).toContain('WP03_LEGACY_RULESET_MIXED_MEMBERSHIP')
    expect(wp03Repair).toContain('WP03_SCENARIO_RULESET_CONFLICT')
    expect(wp03Repair).toContain('WP03_EXPECTED_INVALID_PUBLISHED_SNAPSHOT_MISSING')
    const quarantineBlock = wp03Repair.slice(0, wp03Repair.indexOf('-- Remove the known control-plane acceptance canary'))
    expect(quarantineBlock).not.toContain('CONTINUE;')
    expect(wp03Repair).not.toContain('UPDATE public.contract_rule_snapshots AS published_snapshot')
    expect(wp03Repair).not.toMatch(/DELETE\s+FROM\s+public\.contract_rule_(?:set_)?snapshots/i)
    expect(wp03Repair).not.toContain('DELETE FROM public.contract_skill_bundles')
    const bundlePointerUpdateStart = wp03Repair.indexOf('UPDATE public.contract_skill_bundles AS bundle')
    const bundlePointerUpdate = wp03Repair.slice(
      bundlePointerUpdateStart,
      wp03Repair.indexOf('END LOOP;', bundlePointerUpdateStart)
    )
    expect(bundlePointerUpdate).toContain('SET is_current = false')
    expect(bundlePointerUpdate).toContain('bundle.rule_snapshot_ids && v_invalid_published_snapshot_ids')
    expect(bundlePointerUpdate).toContain('bundle.rule_set_snapshot_ids && v_affected_legacy_set_snapshot_ids')
    expect(bundlePointerUpdate).not.toContain('compiled_from =')
    expect(bundlePointerUpdate).not.toContain('output_schema =')
    expect(bundlePointerUpdate).not.toContain('release_meta =')
    expect(bundlePointerUpdate).not.toContain('compiled_hash =')
    expect(bundlePointerUpdate).not.toContain('status =')
  })

  it('is re-entrant without incrementing an already quarantined rule again', () => {
    const draftOriginGuard = /NOT EXISTS \([\s\S]*?migrated_draft\.rule_id = rule\.id[\s\S]*?_draft_origin[\s\S]*?work_package[\s\S]*?WP03[\s\S]*?canonical_rule_contract_confirmation[\s\S]*?\)/g
    // Outer org discovery, legacy-set/category discovery, and the inner
    // FOR UPDATE mutation all independently exclude an existing WP03 draft.
    expect(wp03Repair.match(draftOriginGuard)?.length).toBeGreaterThanOrEqual(4)
    expect(wp03Repair).toContain("config_snapshot -> '_draft_origin' ->> 'kind' = 'canonical_rule_contract_confirmation'")
    expect(wp03Repair).toContain('SELECT COALESCE(array_agg(rule.id ORDER BY rule.code), ARRAY[]::UUID[])')
  })

  it('reuses only an exact empty WP03 scenario draft and rejects all prior evidence', () => {
    const scenarioGuard = wp03Repair.slice(
      wp03Repair.indexOf('-- Never overwrite an independently created'),
      wp03Repair.indexOf("RAISE EXCEPTION 'WP03_SCENARIO_RULESET_CONFLICT")
    )
    expect(scenarioGuard).toContain("existing_scenario.metadata ->> 'work_package' = 'WP03'")
    expect(scenarioGuard).toContain("existing_scenario.metadata ->> 'membership_state' = 'canonical_rule_contract_confirmation_required'")
    expect(scenarioGuard).toContain("existing_scenario.metadata ->> 'legacy_adapter_publish_forbidden' = 'true'")
    expect(scenarioGuard).toContain("existing_scenario.name = '标准销售合同审核'")
    expect(scenarioGuard).toContain("existing_scenario.description = '面向标准销售合同审核场景的发布边界；问题分类仅用于组织其中的具体规则。'")
    expect(scenarioGuard).toContain("existing_scenario.applicable_scenario = 'standard_sales_contract_review'")
    expect(scenarioGuard).toContain('existing_scenario.priority = 100')
    expect(scenarioGuard).toContain('existing_scenario.is_default = true')
    expect(scenarioGuard).toContain('existing_scenario.is_active = true')
    expect(scenarioGuard).toContain('existing_scenario.version = 1')
    expect(scenarioGuard).toContain("existing_scenario.release_note = 'WP03 重建场景规则集；R001-R015 待业务确认 rule_contract v1'")
    expect(scenarioGuard).toContain(') IS NOT TRUE')
    expect(scenarioGuard).toContain('existing_scenario.current_snapshot_id IS NULL')
    expect(scenarioGuard).toContain('existing_scenario.published_at IS NULL')
    expect(scenarioGuard).toContain('existing_scenario.published_by IS NULL')
    expect(scenarioGuard).toContain('FROM public.contract_rules_v2 AS existing_member')
    expect(scenarioGuard).not.toContain('existing_member.is_active = true')
    expect(scenarioGuard).toContain('FROM public.contract_rule_set_documents AS existing_document')
    expect(scenarioGuard).toContain('FROM public.contract_rule_set_snapshots AS existing_snapshot')
  })

  it('reuses unchanged members exact accepted drafts on a later atomic publication', () => {
    const publishFunction = wp03Repair.slice(
      wp03Repair.indexOf('CREATE OR REPLACE FUNCTION public.publish_contract_rule_set_v1')
    )
    expect(publishFunction).toContain("snapshot.config_snapshot -> '_release_evidence' ->> 'accepted_draft_snapshot_id'")
    expect(publishFunction).toContain('accepted_draft.id = v_acceptance_snapshot_id')
    expect(publishFunction).toContain('accepted_draft.rule_id = v_rule.id')
    expect(publishFunction).toContain('accepted_draft.version = v_rule.version')
    expect(publishFunction).toContain("accepted_draft.status = 'draft'")
    expect(publishFunction).toContain('v_release_contract_sha256 IS DISTINCT FROM v_rule_contract_sha256')
    expect(publishFunction).toContain("v_release_evaluator_revision IS DISTINCT FROM 'rule-contract-v1-20260720'")
    expect(publishFunction).toContain('test_run.rule_snapshot_id = v_acceptance_snapshot_id')
    expect(publishFunction).toContain("v_previous_test_results -> 'rule_runs' -> v_rule.id::TEXT")
    expect(publishFunction).toContain('RULE_FROZEN_ACCEPTANCE_INVALID')
    expect(publishFunction).toContain("frozen_run ->> 'rule_contract_sha256' IS DISTINCT FROM v_rule_contract_sha256")
    expect(publishFunction).toContain("frozen_run ->> 'evaluator_revision' IS DISTINCT FROM 'rule-contract-v1-20260720'")
    expect(publishFunction).toContain('IF v_is_new_rule_release THEN')
  })

  it('enforces one active compiled bundle per immutable content identity', () => {
    expect(wp03Repair).toContain('ADD COLUMN IF NOT EXISTS compiled_identity_generation INTEGER')
    expect(wp03Repair).toContain('ALTER COLUMN compiled_identity_generation SET DEFAULT 1')
    expect(wp03Repair).toContain('idx_contract_skill_bundles_compiled_identity')
    expect(wp03Repair).toContain('compiled_identity_generation')
    expect(wp03Repair).toContain("WHERE status IN ('compiled', 'published')")
    expect(wp03Repair).toContain('ADD COLUMN IF NOT EXISTS compiled_identity_payload JSONB')
    expect(wp03Repair).toContain('AND compiled_identity_generation = 1')
    expect(wp03Repair).not.toContain('ADD COLUMN IF NOT EXISTS compiled_identity_generation INTEGER DEFAULT')
    const identityMigration = wp03Repair.slice(
      wp03Repair.indexOf('-- Existing SkillBundles may already be bound'),
      wp03Repair.indexOf('-- Persist/reuse a bundle')
    )
    expect(identityMigration).not.toContain('UPDATE public.contract_skill_bundles')
    expect(identityMigration).not.toContain('DELETE FROM public.contract_skill_bundles')
  })

  it('serializes bundle reuse, version allocation and formal current switching in one RPC', () => {
    const persistenceFunction = wp03Repair.slice(
      wp03Repair.indexOf('CREATE OR REPLACE FUNCTION public.persist_contract_skill_bundle_v1'),
      wp03Repair.indexOf('-- Rebind unchanged published members')
    )
    expect(persistenceFunction).toContain('pg_catalog.pg_advisory_xact_lock')
    expect(persistenceFunction).toContain('bundle.compiled_hash = p_compiled_hash')
    expect(persistenceFunction).toContain('bundle.status = p_status')
    expect(persistenceFunction).toContain('bundle.compiled_identity_generation = 1')
    expect(persistenceFunction).toContain('v_existing.compiled_identity_payload IS DISTINCT FROM v_identity_payload')
    expect(persistenceFunction).toContain('FROM jsonb_object_keys(p_payload) AS payload_key(key)')
    expect(persistenceFunction).toContain("WHERE payload_key.key NOT IN (")
    expect(persistenceFunction).toContain("'release_meta', v_identity_release_meta")
    expect(persistenceFunction).toContain("- 'compiled_by'")
    expect(persistenceFunction).toContain("- 'updated_at'")
    expect(persistenceFunction).toContain('compiled_identity_generation,')
    expect(persistenceFunction).toContain('compiled_identity_payload,')
    expect(persistenceFunction).toContain('SKILL_BUNDLE_HASH_CONTENT_MISMATCH')
    expect(persistenceFunction).toContain('v_existing.output_schema IS DISTINCT FROM')
    expect(persistenceFunction).toContain('v_existing.compiled_from IS DISTINCT FROM')
    expect(persistenceFunction).toContain('SELECT COALESCE(MAX(bundle.version), 0) + 1')
    expect(persistenceFunction).toContain("IF p_status = 'published' THEN")
    expect(persistenceFunction).toContain('SET is_current = false, updated_at = v_now')
    expect(persistenceFunction).toContain("p_status = 'published'")
    expect(persistenceFunction).toContain('SKILL_BUNDLE_FORMAL_GATE_INVALID')
    expect(persistenceFunction).toContain("p_payload -> 'compiled_from' -> 'rule_translation_gate' ->> 'status' IS DISTINCT FROM 'ready'")
    expect(persistenceFunction).toContain("p_payload -> 'compiled_from' -> 'rule_set_snapshot_gate' ->> 'status' IS DISTINCT FROM 'ready'")
    expect(persistenceFunction).toContain("p_payload -> 'compiled_from' -> 'rule_set_document_gate' ->> 'status' IS DISTINCT FROM 'ready'")
    expect(persistenceFunction).toContain("p_payload -> 'compiled_from' -> 'eval_results' ->> 'rule_acceptance_status' IS DISTINCT FROM 'passed'")
    expect(persistenceFunction).toContain('REVOKE ALL ON FUNCTION public.persist_contract_skill_bundle_v1')
    expect(persistenceFunction).toContain('TO service_role;')
    expect(wp03Repair.match(/GRANT EXECUTE ON FUNCTION public\.persist_contract_skill_bundle_v1/g)).toHaveLength(1)
  })

  it('rejects non-canonical bundle keys before locking or persistence', () => {
    const persistenceFunction = wp03Repair.slice(
      wp03Repair.indexOf('CREATE OR REPLACE FUNCTION public.persist_contract_skill_bundle_v1'),
      wp03Repair.indexOf('-- Rebind unchanged published members')
    )
    expect(persistenceFunction).toContain('v_key TEXT := btrim(p_key)')
    expect(persistenceFunction).toContain('p_key IS DISTINCT FROM v_key')
    expect(persistenceFunction).toContain("p_org_id::TEXT || ':' || v_key")
    expect(persistenceFunction).not.toContain("p_org_id::TEXT || ':' || p_key")
    expect(persistenceFunction).toContain('bundle.key = v_key')
  })

  it('archives only the exact controlled canary live projection', () => {
    expect(wp03Repair).toContain("candidate.code = 'F009_ACCEPT_29685647'")
    expect(wp03Repair).toContain("candidate.metadata ->> 'created_from' = 'config_center_ruleset_api'")
    expect(wp03Repair).toContain("candidate_rule.code = 'MIN_COMMERCIAL_29685647'")
    expect(wp03Repair).toContain('candidate_set.current_snapshot_id IS NOT NULL')
    expect(wp03Repair).toContain('WP03_CANARY_IDENTITY_CONFLICT')
    expect(wp03Repair).toContain('WP03_CANARY_MIXED_MEMBERSHIP')
    expect(wp03Repair).toContain('WP03_CANARY_MIXED_SNAPSHOT_MEMBERSHIP')
    expect(wp03Repair).toContain('COALESCE(cardinality(v_canary_set_snapshot.rule_snapshot_ids), 0) <> 1')
    expect(wp03Repair).toContain('SELECT DISTINCT member.snapshot_id')
    expect(wp03Repair).toContain('historical_snapshots_and_test_runs_preserved')
    expect(wp03Repair).not.toContain("id = '1f454e65-3b58-45b0-b5b4-3135dcc9285a'")
    expect(wp03Repair).not.toContain("id = '4aa0d1df-5ad6-46fb-b8d8-6ffb2fa776f5'")
  })

  it('removes the controlled canary category from navigation without touching history', () => {
    expect(wp03CanaryCategoryReconciliation).toContain("category.code = 'acceptance_29685647'")
    expect(wp03CanaryCategoryReconciliation).toContain("category.name IS DISTINCT FROM '商业门槛验收 29685647（草稿）'")
    expect(wp03CanaryCategoryReconciliation).toContain("rule.code = 'MIN_COMMERCIAL_29685647'")
    expect(wp03CanaryCategoryReconciliation).toContain("rule_set.code = 'F009_ACCEPT_29685647'")
    expect(wp03CanaryCategoryReconciliation).toContain("= 'controlled_acceptance_canary_archived'")
    expect(wp03CanaryCategoryReconciliation).toContain('WP03_CANARY_CATEGORY_IDENTITY_CONFLICT')
    expect(wp03CanaryCategoryReconciliation).toContain('WP03_CANARY_CATEGORY_REMAINS_ACTIVE')
    expect(wp03CanaryCategoryReconciliation).toContain('LOCK TABLE public.contract_rule_sets IN SHARE ROW EXCLUSIVE MODE')
    expect(wp03CanaryCategoryReconciliation).toContain('LOCK TABLE public.contract_rules_v2 IN SHARE ROW EXCLUSIVE MODE')
    expect(wp03CanaryCategoryReconciliation).toContain('LOCK TABLE public.contract_rule_problem_categories IN SHARE ROW EXCLUSIVE MODE')
    expect(wp03CanaryCategoryReconciliation.match(/WP03_CANARY_CATEGORY_IDENTITY_CONFLICT/g)).toHaveLength(2)
    expect(wp03CanaryCategoryReconciliation).toContain('SET is_active = false,')
    expect(wp03CanaryCategoryReconciliation).not.toContain('UPDATE public.contract_rules_v2')
    expect(wp03CanaryCategoryReconciliation).not.toContain('UPDATE public.contract_rule_sets')
    expect(wp03CanaryCategoryReconciliation).not.toContain('UPDATE public.contract_rule_snapshots')
    expect(wp03CanaryCategoryReconciliation).not.toContain('DELETE FROM')
    expect(wp03CanaryCategoryReconciliation).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  })

  it('archives only a provably empty legacy default and leaves one active default', () => {
    expect(wp03Repair).toContain("empty_default.code = 'default'")
    expect(wp03Repair).toContain("empty_default.lifecycle_status = 'draft'")
    expect(wp03Repair).toContain("empty_default.name = '默认规则集'")
    expect(wp03Repair).toContain("empty_default.description = '系统预置的标准合同审核规则'")
    expect(wp03Repair).toContain("empty_default.applicable_scenario = '通用合同审核'")
    expect(wp03Repair).toContain('empty_default.priority = 0')
    expect(wp03Repair).toContain("empty_default.translation_status = 'not_started'")
    expect(wp03Repair).toContain('empty_default.current_snapshot_id IS NULL')
    expect(wp03Repair).toContain('empty_default.published_at IS NULL')
    expect(wp03Repair).toContain("empty_default.metadata = '{}'::JSONB")
    expect(wp03Repair).toContain('FROM public.contract_rule_set_documents AS document')
    expect(wp03Repair).toContain('FROM public.contract_rule_set_snapshots AS snapshot')
    expect(wp03Repair).toContain('WP03_EMPTY_DEFAULT_IDENTITY_CONFLICT')
    const emptyDefaultGuard = wp03Repair.slice(
      wp03Repair.indexOf('-- The original empty `default` container'),
      wp03Repair.indexOf("RAISE EXCEPTION 'WP03_EMPTY_DEFAULT_IDENTITY_CONFLICT")
    )
    expect(emptyDefaultGuard).toContain(') IS NOT TRUE')
    expect(wp03Repair).toContain('WP03_ACTIVE_DEFAULT_CARDINALITY_INVALID')
    expect(wp03Repair).toContain('active_default.is_default = true')
  })

  it('demotes only historical current bundles that consume WP03-quarantined assets', () => {
    expect(wp03PostApplyReconciliation).toContain('v_invalid_bundle_ids UUID[]')
    expect(wp03PostApplyReconciliation).toContain('v_channel_total_count IS DISTINCT FROM v_channel_count')
    expect(wp03PostApplyReconciliation).toContain('v_channel_count > v_invalid_identity_count')
    expect(wp03PostApplyReconciliation).toContain("channel.channel = 'preview_candidate'")
    expect(wp03PostApplyReconciliation).toContain("candidate.release_meta ->> 'stage' = 'candidate'")
    expect(wp03PostApplyReconciliation).toContain("candidate.release_meta ->> 'release_eligible' = 'false'")
    expect(wp03PostApplyReconciliation).toContain("job.status IN ('preparing', 'queued', 'running')")
    expect(wp03PostApplyReconciliation).toContain('DELETE FROM public.contract_skill_bundle_channels AS channel')
    expect(wp03PostApplyReconciliation).toContain('WP03_PREVIEW_CANDIDATE_CHANNEL_DELETE_MISMATCH')
    expect(wp03PostApplyReconciliation).toContain('UPDATE public.contract_skill_bundles AS bundle')
    expect(wp03PostApplyReconciliation).toContain('SET\n    is_current = false,')
    expect(wp03PostApplyReconciliation).toContain("bundle.status = 'published'")
    expect(wp03PostApplyReconciliation).toContain('bundle.compiled_identity_generation IS NULL')
    expect(wp03PostApplyReconciliation).toContain("scenario.code = 'STANDARD_SALES_CONTRACT_REVIEW'")
    expect(wp03PostApplyReconciliation).toContain("scenario.metadata ->> 'work_package' = 'WP03'")
    expect(wp03PostApplyReconciliation).toContain("confirmation_draft.status = 'draft'")
    expect(wp03PostApplyReconciliation).toContain("'superseded_category_shaped_ruleset'")
    expect(wp03PostApplyReconciliation).toContain("'controlled_acceptance_canary_archived'")
    expect(wp03PostApplyReconciliation).toContain('WP03_QUARANTINED_CURRENT_SKILL_BUNDLE_REMAINS')
  })

  it('keeps bundle and snapshot history immutable during post-apply reconciliation', () => {
    const bundleSetClause = wp03PostApplyReconciliation.slice(
      wp03PostApplyReconciliation.indexOf('SET\n    is_current = false,'),
      wp03PostApplyReconciliation.indexOf('WHERE bundle.is_current = true')
    )
    expect(wp03PostApplyReconciliation).not.toContain('DELETE FROM public.contract_skill_bundles')
    expect(wp03PostApplyReconciliation).not.toContain('DELETE FROM public.contract_rule_snapshots')
    expect(wp03PostApplyReconciliation).not.toContain('DELETE FROM public.contract_rule_set_snapshots')
    expect(wp03PostApplyReconciliation).not.toContain('UPDATE public.contract_rule_snapshots')
    expect(wp03PostApplyReconciliation).not.toContain('UPDATE public.contract_rule_set_snapshots')
    expect(wp03PostApplyReconciliation).not.toContain('a226ed0f-5e6f-445f-82c4-378362b45ab5')
    expect(wp03PostApplyReconciliation).not.toContain('b948eaff-a8f1-4a36-a488-c07faffa33a5')
    expect(bundleSetClause).not.toContain('compiled_from =')
    expect(bundleSetClause).not.toContain('output_schema =')
    expect(bundleSetClause).not.toContain('release_meta =')
    expect(bundleSetClause).not.toContain('compiled_hash =')
    expect(bundleSetClause).not.toContain('status =')
  })
})
