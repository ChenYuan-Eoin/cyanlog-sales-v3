import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationName = '20260718040000_add_deterministic_adjudication_candidate_bundle.sql'
const frozenReviewFixName = '20260718041000_bind_adjudication_trace_to_frozen_review.sql'
const immutableTraceFixName = '20260718042000_harden_adjudication_trace_immutability.sql'
const frozenProvenanceFixName = '20260718043000_freeze_deterministic_rule_provenance.sql'
const atomicFactsStagingName = '20260718044000_add_atomic_facts_review_staging.sql'
const factsStagingIndexesName = '20260718045000_add_facts_staging_fk_indexes.sql'
const documentAdjudicationName = '20260718050000_add_document_scope_adjudication_contract.sql'
const overlapFactsFixName = '20260718051000_allow_overlap_deduplicated_facts_stage.sql'
const factsCompletionName = '20260718052000_complete_contract_review_facts.sql'
const factChunkCheckpointName = '20260718065000_add_atomic_fact_chunk_checkpoints.sql'
const factChunkAnchorHardeningName = '20260718066000_harden_fact_checkpoint_source_anchors.sql'
const factTransportAlignmentName = '20260718067000_align_fact_transport_normalization.sql'
const emptyMatchedLevelAlignmentName = '20260718068000_align_empty_matched_level_validation.sql'
const emptyMatchedLevelCoalesceFixName = '20260718069000_fix_empty_matched_level_coalesce.sql'
const previousMigrationName = '20260718023000_optimize_frozen_chunk_anchor_validation.sql'
const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations', migrationName), 'utf8')
const frozenReviewFix = readFileSync(
  resolve(process.cwd(), 'supabase/migrations', frozenReviewFixName),
  'utf8',
)
const immutableTraceFix = readFileSync(
  resolve(process.cwd(), 'supabase/migrations', immutableTraceFixName),
  'utf8',
)
const frozenProvenanceFix = readFileSync(
  resolve(process.cwd(), 'supabase/migrations', frozenProvenanceFixName),
  'utf8',
)
const atomicFactsStaging = readFileSync(
  resolve(process.cwd(), 'supabase/migrations', atomicFactsStagingName),
  'utf8',
)
const factsStagingIndexes = readFileSync(
  resolve(process.cwd(), 'supabase/migrations', factsStagingIndexesName),
  'utf8',
)
const documentAdjudication = readFileSync(
  resolve(process.cwd(), 'supabase/migrations', documentAdjudicationName),
  'utf8',
)
const contractAnalysisWorker = readFileSync(
  resolve(process.cwd(), 'lib/contract-analysis.ts'),
  'utf8',
)
const overlapFactsFix = readFileSync(
  resolve(process.cwd(), 'supabase/migrations', overlapFactsFixName),
  'utf8',
)
const factsCompletion = readFileSync(
  resolve(process.cwd(), 'supabase/migrations', factsCompletionName),
  'utf8',
)
const factChunkCheckpoint = readFileSync(
  resolve(process.cwd(), 'supabase/migrations', factChunkCheckpointName),
  'utf8',
)
const factChunkAnchorHardening = readFileSync(
  resolve(process.cwd(), 'supabase/migrations', factChunkAnchorHardeningName),
  'utf8',
)
const factTransportAlignment = readFileSync(
  resolve(process.cwd(), 'supabase/migrations', factTransportAlignmentName),
  'utf8',
)
const emptyMatchedLevelAlignment = readFileSync(
  resolve(process.cwd(), 'supabase/migrations', emptyMatchedLevelAlignmentName),
  'utf8',
)
const emptyMatchedLevelCoalesceFix = readFileSync(
  resolve(process.cwd(), 'supabase/migrations', emptyMatchedLevelCoalesceFixName),
  'utf8',
)
const failoverRuntime = readFileSync(resolve(process.cwd(), 'lib/ai/failover.ts'), 'utf8')

function withoutComments(sql: string) {
  return sql.replace(/--.*$/gm, '')
}

function candidateFunction(sql: string) {
  const start = sql.indexOf('create or replace function public.create_contract_review_candidate_bundle_v1(')
  const end = sql.indexOf('\n$function$;', start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end + '\n$function$;'.length)
}

function factsStagingFunction(sql: string) {
  const start = sql.indexOf('create or replace function public.stage_contract_review_facts_v1(')
  const end = sql.indexOf('\n$function$;', start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end + '\n$function$;'.length)
}

function documentAdjudicationFunction(sql: string) {
  const start = sql.indexOf('create or replace function public.stage_contract_review_facts_v2(')
  const end = sql.indexOf('\n$function$;', start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end + '\n$function$;'.length)
}

function factsCompletionFunction(sql: string) {
  const start = sql.indexOf('create or replace function public.complete_contract_review_facts_v1(')
  const end = sql.indexOf('\n$function$;', start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end + '\n$function$;'.length)
}

function factsWorkerStagingHelper(source: string) {
  const start = source.indexOf('export async function stageFactsOnlyDirectReviewEvidence(')
  const end = source.indexOf('\nasync function verifyDecisionBatchSource(', start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function factsWorkerExecutionBranch(source: string) {
  const start = source.indexOf(
    "if (verifiedSource.reviewBundle.execution_contract === 'facts_v1')",
  )
  const end = source.indexOf(
    "if (verifiedSource.reviewBundle.execution_contract !== 'legacy_risk_v1')",
    start,
  )
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('deterministic adjudication candidate migration contract', () => {
  it('is strictly ordered after the current migration ledger head', () => {
    expect(previousMigrationName.localeCompare(migrationName)).toBeLessThan(0)
    expect(migrationName.localeCompare(frozenReviewFixName)).toBeLessThan(0)
    expect(frozenReviewFixName.localeCompare(immutableTraceFixName)).toBeLessThan(0)
    expect(immutableTraceFixName.localeCompare(frozenProvenanceFixName)).toBeLessThan(0)
    expect(frozenProvenanceFixName.localeCompare(atomicFactsStagingName)).toBeLessThan(0)
    expect(atomicFactsStagingName.localeCompare(factsStagingIndexesName)).toBeLessThan(0)
    expect(factsStagingIndexesName.localeCompare(documentAdjudicationName)).toBeLessThan(0)
    expect(documentAdjudicationName.localeCompare(overlapFactsFixName)).toBeLessThan(0)
    expect(overlapFactsFixName.localeCompare(factsCompletionName)).toBeLessThan(0)
    expect(migration).toContain("set lock_timeout = '5s'")
    expect(migration).toContain("set statement_timeout = '60s'")
  })

  it('aligns trace chunks with the one-based review runtime and makes the audit log append-only', () => {
    expect(immutableTraceFix).toContain('source_chunk_index >= 1')
    expect(immutableTraceFix).toContain('source_chunk_index <= source_chunk_total')
    expect(immutableTraceFix).not.toContain('source_chunk_index < source_chunk_total')
    expect(immutableTraceFix).toContain('revoke all on table public.contract_review_adjudications from service_role')
    expect(immutableTraceFix).toContain('grant select, insert on table public.contract_review_adjudications to service_role')
    expect(immutableTraceFix).toContain('before update or delete on public.contract_review_adjudications')
    expect(immutableTraceFix).toContain("raise exception 'ADJUDICATION_TRACE_IMMUTABLE'")
    expect(immutableTraceFix).not.toMatch(/^\s*(insert|update|delete|truncate)\s+/gim)
  })

  it('makes PostgreSQL the criteria-hash authority and freezes published provenance assets', () => {
    expect(frozenProvenanceFix).toContain('add column if not exists criteria_hash text')
    expect(frozenProvenanceFix).toContain('new.criteria_hash := v_hash')
    expect(frozenProvenanceFix).toContain("raise exception 'RULE_SNAPSHOT_CRITERIA_HASH_MISMATCH'")
    expect(frozenProvenanceFix).toContain('snapshot.criteria_hash = new.criteria_hash')
    expect(frozenProvenanceFix).not.toContain("pg_catalog.convert_to((snapshot.config_snapshot->'review_criteria')::text")
    expect(frozenProvenanceFix).toContain("raise exception 'PUBLISHED_CONTRACT_ASSET_IMMUTABLE'")
    expect(frozenProvenanceFix).toContain("raise exception 'PUBLISHED_CONTRACT_BUNDLE_IMMUTABLE'")
    expect(frozenProvenanceFix).toContain("to_jsonb(new) - array['is_current', 'updated_at']")
    expect(frozenProvenanceFix).toContain('grant select, insert on table public.contract_rule_snapshots to service_role')
    expect(frozenProvenanceFix).toContain('grant select, insert on table public.contract_rule_set_snapshots to service_role')
    expect(frozenProvenanceFix).toContain('grant update (is_current, updated_at) on public.contract_skill_bundles to service_role')
    expect(withoutComments(frozenProvenanceFix)).not.toMatch(/^\s*(insert|delete|truncate)\s+/gim)
  })

  it('adds the six explicit deterministic rule fields with fail-closed constraints', () => {
    expect(migration).toContain('add column if not exists review_criteria jsonb')
    expect(migration).toContain('add column if not exists conflict_group text')
    expect(migration).toContain('add column if not exists mutually_exclusive_with text[]')
    expect(migration).toContain('add column if not exists specificity integer')
    expect(migration).toContain('add column if not exists default_unknown text')
    expect(migration).toContain('add column if not exists criteria_schema_version integer')
    expect(migration).toContain("jsonb_typeof(review_criteria) = 'object'")
    expect(migration).toContain("default_unknown in ('yellow_review', 'suppress', 'reject_finding')")
    expect(migration).toContain('check (criteria_schema_version = 1)')
    expect(migration).toContain('cardinality(mutually_exclusive_with) = 0 or conflict_group is not null')
  })

  it('stores a complete immutable adjudication trace and verifies cross-table provenance', () => {
    expect(migration).toContain('create table if not exists public.contract_review_adjudications')
    for (const column of [
      'analysis_job_id',
      'model_invocation_id',
      'candidate_id',
      'skill_bundle_version',
      'rule_snapshot_id',
      'source_storage_path',
      'source_hash',
      'source_text_hash',
      'source_exact_text',
      'source_quote_hash',
      'raw_facts',
      'normalized_facts',
      'criteria_hash',
      'adjudicator_version',
      'level_results',
      'matched_levels',
      'decision',
      'reason_code',
      'suppressed_by_candidate_id',
    ]) expect(migration).toContain(column)

    expect(migration).toContain('constraint contract_review_adjudications_candidate_unique unique (review_id, candidate_id)')
    expect(migration).toContain("level_results ?& array['A', 'B', 'C']")
    expect(migration).toContain("decision in ('no_risk', 'materialize', 'suppressed_unknown', 'reject', 'suppressed_conflict')")
    expect(migration).toContain('create or replace function public.validate_contract_review_adjudication_v1()')
    expect(migration).toContain("raise exception 'ADJUDICATION_FROZEN_REVIEW_MISMATCH'")
    expect(migration).toContain("raise exception 'ADJUDICATION_PAGE_MAP_PROVENANCE_INVALID'")
    expect(migration).toContain("raise exception 'ADJUDICATION_RULE_PROVENANCE_INVALID'")
    expect(migration).toContain("raise exception 'ADJUDICATION_INVOCATION_PROVENANCE_INVALID'")
    expect(migration).toContain('public.contract_utf16_slice(')
    expect(migration).toContain("extensions.digest(pg_catalog.convert_to(new.source_exact_text, 'UTF8'), 'sha256')")
    expect(migration).toContain("pg_catalog.convert_to((snapshot.config_snapshot->'review_criteria')::text, 'UTF8')")
  })

  it('binds every trace to the exact frozen ReviewRun bundle and rule snapshot', () => {
    for (const sql of [migration, frozenReviewFix]) {
      expect(sql).toContain('review.skill_bundle_id is not distinct from new.skill_bundle_id')
      expect(sql).toContain('review.rule_version is not distinct from new.skill_bundle_version')
      expect(sql).toContain(
        "new.rule_snapshot_id = any(coalesce(review.rule_snapshot_ids, '{}'::uuid[]))",
      )
      expect(sql).toContain("raise exception 'ADJUDICATION_FROZEN_REVIEW_MISMATCH'")
    }
  })

  it('rejects stale or mismatched page-map provenance before recording a trace', () => {
    for (const sql of [migration, frozenReviewFix]) {
      expect(sql).toContain('join public.contract_source_page_maps as page_map')
      expect(sql).toContain('contract.storage_path is not distinct from new.source_storage_path')
      expect(sql).toContain('page_map.storage_path is not distinct from new.source_storage_path')
      expect(sql).toContain('page_map.source_hash is not distinct from new.source_hash')
      expect(sql).toContain('page_map.source_text_hash is not distinct from new.source_text_hash')
      expect(sql).toContain("pg_catalog.convert_to(coalesce(contract.parsed_text, ''), 'UTF8')")
      expect(sql).toContain("raise exception 'ADJUDICATION_PAGE_MAP_PROVENANCE_INVALID'")
    }
  })

  it('keeps the Preview forward fix limited to replacing the existing trigger function', () => {
    const sql = withoutComments(frozenReviewFix)

    expect(sql.match(/^create or replace function public\.validate_contract_review_adjudication_v1\(\)/gim)).toHaveLength(1)
    expect(sql.match(/\$function\$/g)).toHaveLength(2)
    expect(sql).not.toMatch(/^\s*(create|alter|drop)\s+table\b/im)
    expect(sql).not.toMatch(/^\s*(create|alter|drop)\s+trigger\b/im)
    expect(sql).not.toMatch(/^\s*(insert|update|delete|truncate)\b/im)
  })

  it('provides one typed channel pointer without treating a candidate as release current', () => {
    expect(migration).toContain('create table if not exists public.contract_skill_bundle_channels')
    expect(migration).toContain("channel in ('release_current', 'preview_candidate')")
    expect(migration).toContain('primary key (org_id, key, channel)')
    expect(migration).toContain("new.channel = 'preview_candidate'")
    expect(migration).toContain("bundle.release_meta->>'stage' = 'candidate'")
    expect(migration).toContain("bundle.release_meta->>'release_eligible' = 'false'")
  })

  it('creates only an immutable non-current candidate from already published snapshots', () => {
    const rpc = candidateFunction(migration)

    expect(rpc).toContain("creator.status = 'active'")
    expect(rpc).toContain('join public.user_organizations as membership')
    expect(rpc).toContain("policy.status = 'published'")
    expect(rpc).toContain("snapshot.status = 'published'")
    expect(rpc).toContain("snapshot.config_snapshot->'review_criteria' ?& array['fact_schema', 'level_a', 'level_b', 'level_c']")
    expect(rpc).toContain("raise exception 'CANDIDATE_RULE_SET_MEMBERSHIP_MISMATCH'")
    expect(rpc).toContain("raise exception 'CANDIDATE_RULE_CODES_NOT_UNIQUE'")
    expect(rpc).toContain("'model_policy_id', p_model_policy_id")
    expect(rpc).toContain("'output_schema', p_output_schema")
    expect(rpc).toContain("'output_schema_hash', v_output_schema_hash")
    expect(rpc).toContain("'eval_case_ids', p_eval_case_ids")
    expect(rpc).toContain("extensions.digest(pg_catalog.convert_to(p_output_schema::text, 'UTF8'), 'sha256')")
    expect(rpc).toContain("'stage', 'candidate'")
    expect(rpc).toContain("'release_eligible', false")
    expect(rpc).toMatch(/'published',\s+false,\s+p_rule_snapshot_ids/s)
    expect(rpc).toContain("'preview_candidate'")
    expect(rpc).toContain('on conflict (org_id, key, channel) do update')
    expect(rpc).not.toContain("'release_current'")
    expect(rpc).not.toMatch(/update\s+public\.contract_skill_bundles/i)
    expect(rpc).not.toMatch(/insert\s+into\s+public\.contract_rule_(set_)?snapshots/i)
    expect(rpc).not.toMatch(/update\s+public\.contract_rules_v2/i)
    expect(rpc).not.toMatch(/\bis_current\s*=\s*true\b/i)
  })

  it('does not replay, backfill, or invoke the legacy current-switching publisher', () => {
    const sql = withoutComments(migration)

    expect(sql).not.toContain('publish_contract_rule_set_v1')
    expect(sql).not.toContain('f0c9573f-25d4-4549-9919-e5211de30233')
    expect(sql).not.toMatch(/update\s+public\.contract_rules_v2/i)
    expect(sql).not.toMatch(/insert\s+into\s+public\.contract_rule_(set_)?snapshots/i)
    expect(sql).not.toMatch(/delete\s+from\s+public\.(contract_skill_bundles|contract_rule_snapshots|contract_rule_set_snapshots)/i)
    expect(sql).not.toMatch(/truncate\s+public\./i)
  })

  it('fails closed for browser roles and exposes tables and functions only to service_role', () => {
    expect(migration.match(/^alter table public\.(contract_review_adjudications|contract_skill_bundle_channels) enable row level security;/gim)).toHaveLength(2)
    expect(migration.match(/^revoke all on table public\.(contract_review_adjudications|contract_skill_bundle_channels) from public, anon, authenticated;/gim)).toHaveLength(2)
    expect(migration.match(/^grant all on table public\.(contract_review_adjudications|contract_skill_bundle_channels) to service_role;/gim)).toHaveLength(2)
    expect(migration.match(/^create or replace function public\./gim)).toHaveLength(3)
    expect(migration.match(/^revoke all on function public\./gim)).toHaveLength(3)
    expect(migration.match(/^grant execute on function public\./gim)).toHaveLength(3)
    expect(migration.match(/security definer\nset search_path = ''/gim)).toHaveLength(3)
    expect(migration).not.toMatch(/\bto authenticated\b/i)
  })

  it('adds an append-only atomic facts evidence layer without completing a ReviewRun', () => {
    for (const table of [
      'contract_review_fact_runs',
      'contract_review_fact_chunks',
      'contract_review_rule_coverages',
    ]) {
      expect(atomicFactsStaging).toContain(`create table public.${table}`)
      expect(atomicFactsStaging).toContain(`alter table public.${table} enable row level security`)
      expect(atomicFactsStaging).toContain(`revoke all on table public.${table} from public, anon, authenticated, service_role`)
      expect(atomicFactsStaging).toContain(`grant select on table public.${table} to service_role`)
    }
    expect(atomicFactsStaging).toContain('before update or delete on public.contract_review_fact_runs')
    expect(atomicFactsStaging).toContain('before update or delete on public.contract_review_fact_chunks')
    expect(atomicFactsStaging).toContain('before update or delete on public.contract_review_rule_coverages')
    expect(atomicFactsStaging).toContain("raise exception 'CONTRACT_REVIEW_FACT_AUDIT_IMMUTABLE'")
    expect(atomicFactsStaging).toContain('revoke all on table public.contract_review_adjudications from public, anon, authenticated, service_role')
    expect(atomicFactsStaging).not.toContain('grant select, insert on table public.contract_review_adjudications')
    expect(atomicFactsStaging).toContain("'review_completed', false")
    expect(atomicFactsStaging).not.toMatch(/update\s+public\.(contract_reviews|contracts|contract_analysis_jobs)/i)
    expect(atomicFactsStaging).not.toMatch(/insert\s+into\s+public\.contract_risk_cards/i)
  })

  it('derives complete chunk, invocation, token, output, coverage and source provenance inside one RPC', () => {
    const rpc = factsStagingFunction(atomicFactsStaging)

    expect(rpc).toContain("v_job.status <> 'running'")
    expect(rpc).toContain('v_job.lock_token is distinct from p_lock_token')
    expect(rpc).toContain("v_review.review_trigger <> 'direct'")
    expect(rpc).toContain("channel.channel = 'preview_candidate'")
    expect(rpc).toContain("v_bundle.output_schema @> '{\"contract\":\"contract_review_facts_v1\",\"version\":1}'::jsonb")
    expect(rpc).toContain("v_invocation.phase <> 'fact_extraction'")
    expect(rpc).toContain("v_invocation.status <> 'completed'")
    expect(rpc).toContain('v_invocation.degraded')
    expect(rpc).toContain("response_meta->'usage'->>'totalTokens'")
    expect(rpc).toContain('public.contract_utf16_slice(')
    expect(rpc).toContain("response_meta->'metadata'->>'raw_output_sha256'")
    expect(rpc).toContain('FACTS_STAGE_COVERAGE_MATRIX_INCOMPLETE')
    expect(rpc).toContain("candidate.item->'facts' = v_chunk.raw_facts")
    expect(rpc).toContain('snapshot.criteria_hash')
    expect(rpc).toContain('FACTS_STAGE_SUPPRESSION_PROVENANCE_INVALID')
    expect(rpc).toContain("'idempotent', true")
    expect(rpc).toMatch(/insert into public\.contract_review_fact_runs[\s\S]*insert into public\.contract_review_fact_chunks[\s\S]*insert into public\.contract_review_rule_coverages[\s\S]*insert into public\.contract_review_adjudications/)
  })

  it('keeps operational deletion from mutating audit rows while retaining frozen asset restrictions', () => {
    for (const constraint of [
      'contract_review_adjudications_org_id_fkey',
      'contract_review_adjudications_contract_id_fkey',
      'contract_review_adjudications_review_id_fkey',
      'contract_review_adjudications_analysis_job_id_fkey',
      'contract_review_adjudications_model_invocation_id_fkey',
    ]) expect(atomicFactsStaging).toContain(`drop constraint if exists ${constraint}`)

    expect(atomicFactsStaging).toContain('references public.contract_skill_bundles(id) on delete restrict')
    expect(atomicFactsStaging).toContain('references public.contract_rule_snapshots(id) on delete restrict')
    expect(atomicFactsStaging).toContain('alter column analysis_job_id set not null')
    expect(atomicFactsStaging).toContain('alter column model_invocation_id set not null')
    expect(atomicFactsStaging).toContain('foreign key (fact_chunk_id, fact_run_id)')
  })

  it('does not expose the staging RPC to browser roles or grant direct audit writes', () => {
    expect(atomicFactsStaging).toContain('security definer\nset search_path = \'\'')
    expect(atomicFactsStaging).toContain('revoke all on function public.stage_contract_review_facts_v1(')
    expect(atomicFactsStaging).toContain('from public, anon, authenticated')
    expect(atomicFactsStaging).toContain('grant execute on function public.stage_contract_review_facts_v1(')
    expect(atomicFactsStaging).toContain('to service_role')
    expect(atomicFactsStaging).not.toMatch(/grant (insert|update|delete|all) on table public\.contract_review_(fact|rule|adjud)/i)
  })

  it('covers facts-staging foreign keys without changing data or permissions', () => {
    expect(factsStagingIndexes).toContain('idx_contract_review_adjudications_fact_chunk_run')
    expect(factsStagingIndexes).toContain('on public.contract_review_adjudications(fact_chunk_id, fact_run_id)')
    expect(factsStagingIndexes).toContain('idx_contract_review_adjudications_suppressed_rule_snapshot')
    expect(factsStagingIndexes).toContain('on public.contract_review_adjudications(suppressed_by_rule_snapshot_id)')
    expect(factsStagingIndexes).toContain('idx_contract_review_rule_coverages_chunk_run')
    expect(factsStagingIndexes).toContain('on public.contract_review_rule_coverages(fact_chunk_id, run_id)')
    expect(withoutComments(factsStagingIndexes)).not.toMatch(/^\s*(insert|update|delete|truncate|grant|revoke)\s+/gim)
  })

  it('requires an explicit frozen absence decision only for preview candidates', () => {
    expect(documentAdjudication).toContain("channel.channel = 'preview_candidate'")
    expect(documentAdjudication).toContain("new.channel = 'preview_candidate'")
    expect(documentAdjudication).toContain("snapshot.config_snapshot->'review_criteria'->>'absence_decision'")
    expect(documentAdjudication).toContain("not in ('ignore', 'yellow_review', 'red_risk')")
    expect(documentAdjudication).toContain("raise exception 'PREVIEW_CANDIDATE_ABSENCE_DECISION_REQUIRED'")
    expect(documentAdjudication).toContain("raise exception 'BUNDLE_CHANNEL_ABSENCE_DECISION_INVALID'")
    expect(documentAdjudication).toContain("new.channel = 'release_current'")
  })

  it('stores zero-outcome proof and document-only decisions as append-only evidence', () => {
    expect(documentAdjudication).toContain('create table public.contract_review_document_runs')
    expect(documentAdjudication).toContain('create table public.contract_review_document_adjudications')
    for (const column of [
      'rule_catalog_hash',
      'coverage_matrix_hash',
      'adjudication_hash',
      'frozen_rule_count',
      'outcome_count',
    ]) expect(documentAdjudication).toContain(column)
    for (const column of [
      'document_run_id',
      'fact_run_id',
      'rule_snapshot_id',
      'criteria_hash',
      'evidence_basis',
      'configured_absence_decision',
      'decision',
      'severity',
      'materialize',
      'reason_code',
      'coverage_chunk_count',
      'observed_chunk_count',
      'uncertain_chunk_count',
      'not_observed_chunk_count',
      'customer_output_eligible',
    ]) expect(documentAdjudication).toContain(column)
    expect(documentAdjudication).toContain("'complete_not_observed_coverage'")
    expect(documentAdjudication).toContain("'uncertain_coverage'")
    expect(documentAdjudication).toContain('check (not customer_output_eligible)')
    expect(documentAdjudication).toContain('before update or delete on public.contract_review_document_runs')
    expect(documentAdjudication).toContain('before update or delete on public.contract_review_document_adjudications')
    expect(documentAdjudication).toContain('execute function public.reject_contract_review_fact_audit_mutation_v1()')
    expect(documentAdjudication).toContain('alter table public.contract_review_document_runs enable row level security')
    expect(documentAdjudication).toContain('alter table public.contract_review_document_adjudications enable row level security')
    expect(documentAdjudication).toContain('revoke all on table public.contract_review_document_runs')
    expect(documentAdjudication).toContain('revoke all on table public.contract_review_document_adjudications')
    expect(documentAdjudication).toContain('from public, anon, authenticated, service_role')
    expect(documentAdjudication).toContain('grant select on table public.contract_review_document_runs to service_role')
    expect(documentAdjudication).toContain('grant select on table public.contract_review_document_adjudications to service_role')
    expect(documentAdjudication).not.toMatch(/grant (insert|update|delete|all) on table public\.contract_review_document_runs/i)
    expect(documentAdjudication).not.toMatch(/grant (insert|update|delete|all) on table public\.contract_review_document_adjudications/i)
  })

  it('derives document decisions in the same transaction without accepting invented anchors', () => {
    const rpc = documentAdjudicationFunction(documentAdjudication)

    expect(rpc).toContain('public.stage_contract_review_facts_v1(')
    expect(rpc).toContain("count(*) filter (where coverage.status = 'observed')")
    expect(rpc).toContain("count(*) filter (where coverage.status = 'uncertain')")
    expect(rpc).toContain("when per_rule.uncertain_chunk_count > 0 then 'uncertain_coverage'")
    expect(rpc).toContain("then 'complete_not_observed_no_finding'")
    expect(rpc).toContain("then 'required_clause_absent_yellow'")
    expect(rpc).toContain("else 'required_clause_absent_red'")
    expect(rpc).toContain('where per_rule.observed_chunk_count = 0')
    expect(rpc).toContain('on conflict (fact_run_id) do nothing')
    expect(rpc).toContain("raise exception 'DOCUMENT_ADJUDICATION_ALREADY_STAGED_CONFLICT'")
    expect(rpc).toContain("raise exception 'DOCUMENT_ADJUDICATION_PERSISTED_MATRIX_MISMATCH'")
    expect(rpc).toContain("'document_run_id', v_document_run_id")
    expect(rpc).toContain("'document_idempotent', v_document_idempotent")
    expect(rpc).toContain("'risk_cards_materialized', false")
    expect(rpc).toContain("'review_completed', false")
    expect(rpc).not.toContain('source_quote')
    expect(rpc).not.toContain('source_start')
    expect(rpc).not.toContain('source_end')
    expect(withoutComments(documentAdjudication)).not.toMatch(/insert\s+into\s+public\.contract_risk_cards/i)
    expect(withoutComments(documentAdjudication)).not.toMatch(/update\s+public\.(contract_reviews|contracts|contract_analysis_jobs)/i)
  })

  it('hashes the rule catalogue, coverage matrix and empty-or-nonempty outcome set', () => {
    const rpc = documentAdjudicationFunction(documentAdjudication)

    expect(rpc).toContain("into v_rule_catalog")
    expect(rpc).toContain("into v_coverage_matrix")
    expect(rpc).toContain("into v_outcomes")
    expect(rpc).toContain("'outcomes', v_outcomes")
    expect(rpc).toContain("coalesce(jsonb_agg(")
    expect(rpc).toContain("'[]'::jsonb")
    expect(documentAdjudication).not.toContain('alter table public.contract_risk_cards')
  })

  it('exposes the document staging wrapper only to service_role', () => {
    expect(documentAdjudication).toContain("security definer\nset search_path = ''")
    expect(documentAdjudication).toContain('revoke all on function public.stage_contract_review_facts_v2(')
    expect(documentAdjudication).toContain('from public, anon, authenticated, service_role')
    expect(documentAdjudication).toContain('grant execute on function public.stage_contract_review_facts_v2(')
    expect(documentAdjudication).toContain('to service_role')
    expect(documentAdjudication).toContain('revoke all on function public.stage_contract_review_facts_v1(')
    expect(documentAdjudication).toMatch(/stage_contract_review_facts_v1\([\s\S]*?from public, anon, authenticated, service_role;/)
  })

  it('allows intentional overlap deduplication without weakening document coverage', () => {
    const rpc = documentAdjudicationFunction(overlapFactsFix)
    const sql = withoutComments(overlapFactsFix)

    expect(rpc).toContain("raise exception 'DOCUMENT_ADJUDICATION_SOURCE_TRACE_MATRIX_INVALID'")
    expect(rpc).toContain("(per_rule.observed_chunk_count > 0) is distinct from exists")
    expect(rpc).not.toContain('v_raw_candidate_count')
    expect(rpc).not.toContain('v_trace_count')
    expect(rpc).not.toContain('DOCUMENT_ADJUDICATION_CANDIDATE_TRACE_COUNT_INVALID')
    expect(overlapFactsFix).toContain('revoke all on function public.stage_contract_review_facts_v1(')
    expect(overlapFactsFix).toContain('grant execute on function public.stage_contract_review_facts_v2(')
    expect(sql).not.toMatch(/^\s*(create|alter|drop)\s+table\b/im)
    expect(sql).not.toMatch(/public\.contract_risk_cards/i)
    expect(sql).not.toMatch(/update\s+public\.(contract_reviews|contracts|contract_analysis_jobs)/i)
  })

  it('resumes staged facts before provider work and completes without legacy writers', () => {
    const helper = factsWorkerStagingHelper(contractAnalysisWorker)
    const branch = factsWorkerExecutionBranch(contractAnalysisWorker)

    expect(helper).toContain('extractReviewFactsWithFailoverSync(chunk.text')
    expect(helper).toContain("phase: 'fact_extraction'")
    expect(helper).toContain('frozenModelPolicy: reviewBundle.model_policy')
    expect(helper).toContain('deterministicRules: reviewBundle.rules')
    expect(helper).toContain('let preferredProvider = verifiedSource.preferredProvider')
    expect(helper).toContain('preferredProvider = extraction.provider')
    expect(helper.indexOf('preferredProvider = extraction.provider')).toBeGreaterThan(
      helper.indexOf('extractReviewFactsWithFailoverSync(chunk.text'),
    )
    expect(helper).toContain('adjudicateParsedFactsOnlyExtractionChunk({')
    expect(helper).toContain('mergeFactsOnlyAdjudicationBatches(batches, verifiedSource.sourceText)')
    expect(helper).toContain('buildFactsOnlyAdjudicationTraceInputs(merged, invocationIdsByChunk)')
    expect(helper).toContain('buildFactsOnlyDocumentAdjudicationInputs(')
    expect(helper).toContain("supabaseAdmin.rpc('stage_contract_review_facts_v2'")
    expect(helper).toContain('p_chunks: stagingChunks')
    expect(helper).toContain('p_adjudications: adjudications')
    expect(helper).toContain('chunk.text.length > 4000')
    expect(helper).not.toContain('runStructuredAnalysis(')
    expect(helper).not.toContain('saveStructuredReport(')
    expect(helper).not.toContain('markContractAnalysisCompleted(')
    expect(helper).toContain('loadFactsOnlyResumeState(job, verifiedSource.reviewBundle)')
    expect(helper).toContain('loadFactsOnlyCheckpointState(job)')
    expect(helper).toContain('checkpointSuccessfulFactExtraction(')
    expect(helper).toContain('persistSuccessfulExtraction: (evidence) =>')
    expect(helper).toContain('prepareSuccessfulExtraction: (providerExtraction) =>')
    expect(helper).toContain('normalizeFactsOnlyExtractionSourceAnchors(')
    expect(helper).toContain('parseFactsOnlyExtraction(checkpoint.raw_output')
    expect(helper).toContain("initial.kind === 'staged'")
    expect(helper).toContain("initial.kind === 'orphan_invocations'")
    expect(helper).toContain('stageFactsOnlyDirectReviewEvidence(job, verifiedSource, assertLease)')
    expect(helper.indexOf('loadFactsOnlyResumeState(job, verifiedSource.reviewBundle)')).toBeLessThan(
      helper.indexOf('stageFactsOnlyDirectReviewEvidence(job, verifiedSource, assertLease)'),
    )
    expect(branch).toContain('resolveFactsOnlyStageIdentity(')
    expect(branch).toContain('completeFactsOnlyDirectReview(job, factsStageIdentity)')
    expect(branch).not.toContain('runStructuredAnalysis(')
    expect(branch).not.toContain('verifyAndBindReviewModelEvidence(')
    expect(branch).not.toContain('saveStructuredReport(')
    expect(branch).not.toContain('markContractAnalysisCompleted(')
  })

  it('atomically checkpoints successful chunks and permits only one bounded resume', () => {
    const sql = withoutComments(factChunkCheckpoint)
    const checkpointRpcStart = sql.indexOf(
      'create or replace function public.checkpoint_contract_review_fact_chunk_v1(',
    )
    const checkpointRpcEnd = sql.indexOf('\n$function$;', checkpointRpcStart)
    const checkpointRpc = sql.slice(checkpointRpcStart, checkpointRpcEnd)

    expect(factChunkCheckpointName.localeCompare('20260718064000_fix_preview_runtime_calibration_bundle_clone.sql')).toBeGreaterThan(0)
    expect(factChunkAnchorHardeningName.localeCompare(factChunkCheckpointName)).toBeGreaterThan(0)
    expect(factTransportAlignmentName.localeCompare(factChunkAnchorHardeningName)).toBeGreaterThan(0)
    expect(emptyMatchedLevelAlignmentName.localeCompare(factTransportAlignmentName)).toBeGreaterThan(0)
    expect(emptyMatchedLevelCoalesceFixName.localeCompare(emptyMatchedLevelAlignmentName)).toBeGreaterThan(0)
    expect(sql).toContain('create table public.contract_review_fact_chunk_checkpoints')
    expect(sql).toContain('unique (analysis_job_id, chunk_index)')
    expect(sql).toContain('unique (model_invocation_id)')
    expect(sql).toContain('alter table public.contract_review_fact_chunk_checkpoints enable row level security')
    expect(sql).toContain('revoke all on table public.contract_review_fact_chunk_checkpoints')
    expect(sql).toContain('grant select on table public.contract_review_fact_chunk_checkpoints to service_role')
    expect(checkpointRpc).toContain('insert into public.model_invocations')
    expect(checkpointRpc).toContain('insert into public.contract_review_fact_chunk_checkpoints')
    expect(checkpointRpc.indexOf('insert into public.model_invocations')).toBeLessThan(
      checkpointRpc.indexOf('insert into public.contract_review_fact_chunk_checkpoints'),
    )
    expect(checkpointRpc).toContain('FACT_CHUNK_COMPLETED_INVOCATION_WITHOUT_CHECKPOINT')
    expect(sql).toContain('create or replace function public.requeue_contract_review_facts_once_v1(')
    expect(sql).toContain("v_job.attempts <> 1")
    expect(sql).toContain('attempts = 2')
    expect(sql).toContain('FACTS_REQUEUE_AMBIGUOUS_COMPLETED_INVOCATION')
    expect(failoverRuntime).toContain('facts_only_atomic_checkpoint_writer_required')
    expect(failoverRuntime).toContain('facts_only_source_validation_hook_required')
    expect(failoverRuntime).toContain('model_fact_normalization_count')
    expect(failoverRuntime).toContain('model_fact_normalizations')
    expect(failoverRuntime).toContain('deterministic_validation:')
    expect(failoverRuntime).not.toContain('recordModelInvocationWithId')
    expect(contractAnalysisWorker).toContain("supabaseAdmin.rpc('requeue_contract_review_facts_once_v1'")
    expect(factChunkAnchorHardening).toContain(
      'create or replace function public.contract_fact_chunk_quote_is_recoverable_v1(',
    )
    expect(factChunkAnchorHardening).toContain('source_anchor_validated boolean not null default false')
    expect(factChunkAnchorHardening).toContain('check (source_anchor_validated) not valid')
    expect(factChunkAnchorHardening).toContain('FACT_CHUNK_CHECKPOINT_RPC_PATCH_DRIFT')
    expect(factChunkAnchorHardening).toContain("source_anchor_validated, created_at")
    expect(factChunkAnchorHardening).toContain("v_checkpoint_hash, true, v_now")
    expect(factTransportAlignment).toContain('FACT_TRANSPORT_ALIGNMENT_PATCH_DRIFT')
    expect(factTransportAlignment).toContain('and v_existing.source_anchor_validated then')
    expect(factTransportAlignment).toContain('model_fact_normalization_count')
    expect(factTransportAlignment).toContain('FACT_CHUNK_CHECKPOINT_NORMALIZATION_COUNT_MISMATCH')
    expect(factTransportAlignment).toContain(
      "regexp_replace(btrim(v_source_exact_text), '[[:space:]]+', '', 'g')",
    )
    expect(factTransportAlignment).toContain(
      "regexp_replace(btrim(v_chunk.candidate_source_quote), '[[:space:]]+', '', 'g')",
    )
    expect(factTransportAlignment).toContain('pg_catalog.substr(p_chunk_text, v_first + 1)')
    expect(factTransportAlignment).toContain('pg_catalog.substr(v_chunk_projection, v_first + 1)')
    expect(withoutComments(factTransportAlignment)).not.toMatch(
      /^\s*(create|alter|drop)\s+table\b/gim,
    )
    expect(emptyMatchedLevelAlignment).toContain('FACTS_EMPTY_MATCHED_LEVEL_PATCH_DRIFT')
    expect(emptyMatchedLevelAlignment).toContain(
      "pg_catalog.coalesce(v_matched_level = 'A', false)",
    )
    expect(emptyMatchedLevelAlignment).toContain(
      "pg_catalog.coalesce(v_matched_level = 'B', false)",
    )
    expect(emptyMatchedLevelAlignment).toContain(
      "pg_catalog.coalesce(v_matched_level = 'C', false)",
    )
    expect(emptyMatchedLevelAlignment).toContain(
      'revoke all on function public.stage_contract_review_facts_v1(',
    )
    expect(emptyMatchedLevelAlignment).toContain(
      'grant execute on function public.stage_contract_review_facts_v2(',
    )
    expect(emptyMatchedLevelCoalesceFix).toContain(
      'FACTS_EMPTY_MATCHED_LEVEL_COALESCE_PATCH_DRIFT',
    )
    expect(emptyMatchedLevelCoalesceFix).toContain(
      "v_invalid_fragment text := 'pg_catalog.coalesce(v_matched_level ='",
    )
    expect(emptyMatchedLevelCoalesceFix).toContain(
      "v_valid_fragment text := 'coalesce(v_matched_level ='",
    )
    expect(emptyMatchedLevelCoalesceFix).toContain('if v_occurrences <> 3 then')
    expect(emptyMatchedLevelCoalesceFix).toContain(
      'grant execute on function public.stage_contract_review_facts_v2(',
    )
    expect(withoutComments(emptyMatchedLevelAlignment)).not.toMatch(
      /^\s*(create|alter|drop)\s+table\b/gim,
    )
    expect(withoutComments(emptyMatchedLevelAlignment)).not.toMatch(
      /^\s*(insert|update|delete)\s+/gim,
    )
    expect(withoutComments(emptyMatchedLevelCoalesceFix)).not.toMatch(
      /^\s*(create|alter|drop)\s+table\b/gim,
    )
    expect(withoutComments(emptyMatchedLevelCoalesceFix)).not.toMatch(
      /^\s*(insert|update|delete)\s+/gim,
    )
  })

  it('stores one append-only completion receipt without granting service-role writes', () => {
    expect(factsCompletion).toContain(
      'create table public.contract_review_facts_completion_receipts',
    )
    expect(factsCompletion).toContain(
      'foreign key (document_run_id, fact_run_id)',
    )
    expect(factsCompletion).toContain(
      'references public.contract_review_document_runs(id, fact_run_id)',
    )
    for (const evidence of [
      'model_invocation_ids',
      'invocation_manifest',
      'raw_candidate_occurrence_count',
      'raw_distinct_candidate_count',
      'source_trace_count',
      'document_outcome_count',
      'risk_card_ids',
      'risk_manifest',
      'terminal_payload',
      'receipt_hash',
    ]) expect(factsCompletion).toContain(evidence)
    expect(factsCompletion).toContain(
      'alter table public.contract_review_facts_completion_receipts enable row level security',
    )
    expect(factsCompletion).toContain(
      'revoke all on table public.contract_review_facts_completion_receipts',
    )
    expect(factsCompletion).toContain(
      'from public, anon, authenticated, service_role',
    )
    expect(factsCompletion).toContain(
      'grant select on table public.contract_review_facts_completion_receipts to service_role',
    )
    expect(factsCompletion).toContain(
      'before update or delete on public.contract_review_facts_completion_receipts',
    )
    expect(factsCompletion).toContain(
      'create or replace function public.fence_contract_review_facts_risk_projection_v1()',
    )
    expect(factsCompletion).toContain(
      'before insert or update or delete on public.contract_risk_cards',
    )
    expect(factsCompletion).toContain(
      "array['status', 'fixed_by', 'fixed_at', 'updated_at']::text[]",
    )
    expect(factsCompletion).toContain('FACTS_COMPLETION_EXTRA_RISK_CARD_FORBIDDEN')
    expect(factsCompletion).toContain('FACTS_COMPLETION_RISK_CORE_IMMUTABLE')
    expect(factsCompletion).not.toMatch(
      /grant (insert|update|delete|all) on table public\.contract_review_facts_completion_receipts/i,
    )
  })

  it('completes facts ReviewRuns from immutable evidence rather than caller-authored results', () => {
    const rpc = factsCompletionFunction(factsCompletion)
    const signature = rpc.slice(0, rpc.indexOf(')\nreturns jsonb'))

    for (const parameter of [
      'p_job_id uuid',
      'p_contract_id uuid',
      'p_review_id uuid',
      'p_lock_token uuid',
      'p_fact_run_id uuid',
      'p_document_run_id uuid',
    ]) expect(signature).toContain(parameter)
    expect(signature).not.toMatch(/p_(risks|review_result|provider|degraded|tokens|summary)/)
    expect(rpc).toContain("v_job.status <> 'running'")
    expect(rpc).toContain('v_job.lock_token is distinct from p_lock_token')
    expect(rpc).toContain("channel.channel = 'preview_candidate'")
    expect(rpc).toContain(
      '"manifest_hash":"da8c818aeed5bd7abef2b3b9a28721a1ef9d10deb08ff0ac2eeb91d930fbf5e7"',
    )
    expect(rpc).toContain("= 'g5.deterministic-preview-model-policy.v1'")
    expect(rpc).toContain('v_fact_run.model_policy_hash is distinct from v_policy_hash')
    expect(rpc).toContain('from public.contract_review_fact_chunks as chunk')
    expect(rpc).toContain('chunk.model_invocation_id')
    expect(rpc).toContain('chunk.total_tokens')
    expect(rpc).toContain('raw_distinct_candidate_count')
    expect(rpc).toContain('FACTS_COMPLETE_DISTINCT_CANDIDATE_TRACE_MISMATCH')
    expect(rpc).toContain('FACTS_COMPLETE_TERMINAL_PROJECTION_CHANGED')
    expect(rpc).toContain('v_existing_receipt.risk_manifest_hash')
    expect(rpc).toContain('v_existing_receipt.terminal_payload_hash')
    expect(rpc).toContain('v_existing_receipt.receipt_hash')
    expect(rpc).toContain('card.evidence is distinct from expected.evidence')
    expect(rpc).toContain("item.value->>'evidence_scope' = 'source_span'")
    expect(rpc).toContain("item.value->>'evidence_scope' = 'document_coverage'")
    expect(rpc).toContain("'source_anchor_status', 'exact_frozen_chunk'")
    expect(rpc).toContain("'source_anchor_match_field', 'source_quote'")
    expect(rpc).toContain("'source_anchor_status', 'unresolved'")
    expect(rpc).toContain("'customer_output_eligible', false")
    expect(rpc).toContain("snapshot.config_snapshot->'message_template'->>'risk_title'")
    expect(rpc).toContain("snapshot.config_snapshot->'message_template'->>'comment_template'")
    expect(rpc).toContain('insert into public.contract_risk_cards')
    expect(rpc).toContain('model_invocation_ids = v_model_invocation_ids')
    expect(rpc).toContain('report_version = 3')
    expect(rpc).toContain("set status = 'COMPLETED'")
    expect(rpc).toContain("set status = 'completed'")
    expect(rpc).not.toContain('public.stage_contract_analysis_report(')
    expect(rpc).not.toContain('public.complete_contract_analysis_job(')
  })

  it('inserts the receipt before projection and terminal state, then supports response-loss retry', () => {
    const rpc = factsCompletionFunction(factsCompletion)
    const receiptInsert = rpc.indexOf(
      'insert into public.contract_review_facts_completion_receipts',
    )
    const riskInsert = rpc.indexOf('insert into public.contract_risk_cards')
    const contractUpdate = rpc.indexOf('update public.contracts')
    const reviewUpdate = rpc.indexOf('update public.contract_reviews')
    const jobUpdate = rpc.indexOf('update public.contract_analysis_jobs')

    expect(receiptInsert).toBeGreaterThan(0)
    expect(receiptInsert).toBeLessThan(riskInsert)
    expect(riskInsert).toBeLessThan(contractUpdate)
    expect(contractUpdate).toBeLessThan(reviewUpdate)
    expect(reviewUpdate).toBeLessThan(jobUpdate)
    expect(rpc).toContain("if v_job.status = 'completed' then")
    expect(rpc).toContain("'idempotent', true")
    expect(rpc).toContain('v_existing_receipt.terminal_payload')
    expect(rpc).toContain('FACTS_COMPLETE_RISK_PROJECTION_CHANGED')
    expect(rpc).toContain("set lock_timeout = '5s'")
    const activeCompletion = rpc.slice(rpc.indexOf("if v_job.status <> 'running'"))
    expect(activeCompletion.indexOf('lock table public.contract_risk_cards')).toBeLessThan(
      activeCompletion.indexOf('select contract.*'),
    )
  })

  it('fences only facts-backed completion from bypassing the atomic receipt', () => {
    expect(factsCompletion).toContain(
      'create or replace function public.fence_contract_review_facts_completion_v1()',
    )
    expect(factsCompletion).toContain("raise exception 'FACTS_COMPLETION_RECEIPT_REQUIRED'")
    expect(factsCompletion).toContain('before update of status on public.contract_reviews')
    expect(factsCompletion).toContain('before update of status on public.contract_analysis_jobs')
    expect(factsCompletion).toContain('before update of status on public.contracts')
    expect(factsCompletion).toContain('from public.contract_review_fact_runs as fact_run')
    expect(factsCompletion).toContain(
      'from public.contract_review_facts_completion_receipts as receipt',
    )
    expect(factsCompletion).toContain("review.status = 'ANALYZING'")
    expect(factsCompletion).toContain("or job.status in ('queued', 'running')")
    expect(factsCompletion).toMatch(
      /review\.status = 'ANALYZING'\s+or job\.status in \('queued', 'running'\)/,
    )
    expect(factsCompletion).not.toContain(
      'create or replace function public.complete_contract_analysis_job(',
    )
    expect(factsCompletion).toContain(
      'revoke all on function public.complete_contract_review_facts_v1(',
    )
    expect(factsCompletion).toContain(
      'from public, anon, authenticated, service_role',
    )
    expect(factsCompletion).toContain(
      'grant execute on function public.complete_contract_review_facts_v1(',
    )
    expect(factsCompletion).toContain('to service_role')
  })
})
