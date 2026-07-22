import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationDirectory = resolve(process.cwd(), 'supabase/migrations')
const protectedLegacyName = '20260716065437_add_multiformat_source_annotation_anchors.sql'
const baselineName = '20260717041512_reconcile_g5_review_workbench_baseline.sql'
const g5Name = '20260717041801_add_multiformat_source_annotation_anchors.sql'
const storageName = '20260717070249_g5_harden_contract_storage_buckets.sql'
const reviewUpdatedAtName = '20260717071127_reconcile_contract_reviews_updated_at.sql'
const stageReportFixName = '20260717071901_fix_stage_contract_analysis_report_ambiguity.sql'
const browserWordModeName = '20260717162000_add_browser_word_preview_render_mode.sql'
const frozenChunkAnchorName = '20260718014000_allow_frozen_chunk_source_anchors.sql'
const frozenChunkAnchorPerformanceName = '20260718023000_optimize_frozen_chunk_anchor_validation.sql'
const deterministicCandidateCreateName = '20260718053000_create_deterministic_preview_candidate.sql'
const deterministicCandidateStartName = '20260718054000_start_deterministic_preview_candidate.sql'
const sourceTextRepairName = '20260718060000_reconcile_word_source_text_projection.sql'
const sourceTextRepairMembershipFixName = '20260718061000_fix_word_source_text_repair_membership.sql'
const sourceTextRepairPageRangeFixName = '20260718062000_fix_word_source_text_repair_page_range.sql'
const runtimeCalibrationName = '20260718063000_calibrate_deterministic_preview_candidate_runtime.sql'
const runtimeCalibrationFixName = '20260718064000_fix_preview_runtime_calibration_bundle_clone.sql'

function readMigration(name: string) {
  return readFileSync(resolve(migrationDirectory, name), 'utf8')
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function withoutLineComments(sql: string) {
  return sql.replace(/--.*$/gm, '')
}

describe('G5 migration contract', () => {
  it('keeps the canonical baseline before the source-identity migration', () => {
    expect(baselineName.localeCompare(g5Name)).toBeLessThan(0)

    const registry = readFileSync(resolve(process.cwd(), '../REQ_REGISTRY.yml'), 'utf8')
    const baselinePosition = registry.indexOf(`supabase/migrations/${baselineName}`)
    const g5Position = registry.indexOf(`supabase/migrations/${g5Name}`)
    const storagePosition = registry.indexOf(`supabase/migrations/${storageName}`)
    const reviewUpdatedAtPosition = registry.indexOf(`supabase/migrations/${reviewUpdatedAtName}`)
    const stageReportFixPosition = registry.indexOf(`supabase/migrations/${stageReportFixName}`)
    const browserWordModePosition = registry.indexOf(`supabase/migrations/${browserWordModeName}`)
    const frozenChunkAnchorPosition = registry.indexOf(`supabase/migrations/${frozenChunkAnchorName}`)
    const frozenChunkAnchorPerformancePosition = registry.indexOf(
      `supabase/migrations/${frozenChunkAnchorPerformanceName}`,
    )

    expect(baselinePosition).toBeGreaterThanOrEqual(0)
    expect(g5Position).toBeGreaterThan(baselinePosition)
    expect(storagePosition).toBeGreaterThan(g5Position)
    expect(reviewUpdatedAtPosition).toBeGreaterThan(storagePosition)
    expect(stageReportFixPosition).toBeGreaterThan(reviewUpdatedAtPosition)
    expect(browserWordModePosition).toBeGreaterThan(stageReportFixPosition)
    expect(frozenChunkAnchorPosition).toBeGreaterThan(browserWordModePosition)
    expect(frozenChunkAnchorPerformancePosition).toBeGreaterThan(frozenChunkAnchorPosition)
    expect(registry).not.toContain(`supabase/migrations/${protectedLegacyName}`)
  })

  it('reconciles final schema without replaying historical data mutations', () => {
    const baseline = withoutLineComments(readMigration(baselineName))

    expect(baseline).toContain('contract_review_submission_batches')
    expect(baseline).toContain('contract_review_decision_drafts')
    expect(baseline).toContain('contract_source_page_maps')
    expect(baseline).not.toMatch(/^\s*(update|insert|delete|truncate)\b/im)
    expect(baseline).not.toMatch(/\bversion_number\b/i)
    expect(baseline).toContain("from public, anon, authenticated")
    expect(baseline).toContain("to service_role")
  })

  it('preserves the protected G5 bytes while using the later canonical filename', () => {
    const protectedLegacy = readMigration(protectedLegacyName)
    const g5 = readMigration(g5Name)
    const expectedHash = '8d3bbddcec0ff8ebad084b80d97db08bf7e6018139b0eefc21b75864f5c004c5'

    expect(sha256(protectedLegacy)).toBe(expectedHash)
    expect(sha256(g5)).toBe(expectedHash)
  })

  it('revokes every G5 function from public roles and grants only service_role', () => {
    const g5 = readMigration(g5Name)
    const functions = g5.match(/^create or replace function /gim) ?? []
    const revokes = g5.match(/^revoke all on function /gim) ?? []
    const hardenedRevokes = g5.match(/from public, anon, authenticated;/gim) ?? []
    const serviceRoleGrants = g5.match(/to service_role;/gim) ?? []

    expect(functions).toHaveLength(22)
    expect(revokes).toHaveLength(22)
    expect(hardenedRevokes).toHaveLength(22)
    expect(serviceRoleGrants).toHaveLength(22)
    expect(g5).not.toMatch(/from public;\s*$/im)
  })

  it('closes the free Storage boundary without browser bucket access', () => {
    const storage = withoutLineComments(readMigration(storageName))

    expect(storage).toContain('file_size_limit = 52428800')
    expect(storage).toContain('file_size_limit = 4194304')
    expect(storage).toContain('application/vnd.ms-word.document.macroEnabled.12')
    expect(storage).not.toContain("'image/png'")
    expect(storage).not.toContain("'image/jpeg'")
    expect(storage.match(/^drop policy if exists /gim)).toHaveLength(4)
    expect(storage).not.toMatch(/^\s*(insert|delete|truncate)\b/im)
  })

  it('reconciles the ReviewRun timestamp assumed by every lifecycle function', () => {
    const reconciliation = withoutLineComments(readMigration(reviewUpdatedAtName))

    expect(reconciliation).toContain('alter table public.contract_reviews')
    expect(reconciliation).toContain('add column if not exists updated_at timestamptz')
    expect(reconciliation).toContain('coalesce(completed_at, started_at, created_at, now())')
    expect(reconciliation).toContain('alter column updated_at set not null')
    expect(reconciliation).toContain('create trigger trg_contract_reviews_updated_at')
    expect(reconciliation).toContain("set search_path = ''")
    expect(reconciliation).toContain('from public, anon, authenticated')
    expect(reconciliation).toContain('to service_role')
    expect(reconciliation).not.toMatch(/^\s*(delete|insert|truncate)\b/im)
    expect(reconciliation).not.toMatch(/\b(drop|rename)\s+(table|column)\b/i)
  })

  it('qualifies the staged ReviewRun query without changing the RPC boundary', () => {
    const fix = withoutLineComments(readMigration(stageReportFixName))

    expect(fix).toContain('create or replace function public.stage_contract_analysis_report(')
    expect(fix).toContain('select review.status,')
    expect(fix).toContain('review.review_trigger')
    expect(fix).toContain('from public.contract_reviews as review')
    expect(fix).toContain('for update of review;')
    expect(fix).not.toContain('select status, review_trigger, strategy_id')
    expect(fix).toContain("set search_path = ''")
    expect(fix).toContain('from public, anon, authenticated')
    expect(fix).toContain('to service_role')
  })

  it('records browser OOXML preview without pretending it was converted to PDF', () => {
    const migration = readMigration(browserWordModeName)
    expect(migration).toContain("'browser-ooxml'")
    expect(migration).toContain("'identity-only'")
    expect(migration).toContain("'native-pdf'")
    expect(migration).toContain('contract_source_page_maps_render_mode_check')
  })

  it('accepts repeated text only through a completed frozen chunk proof', () => {
    const migration = withoutLineComments(readMigration(frozenChunkAnchorName))

    expect(migration).toContain('create or replace function public.contract_utf16_slice(')
    expect(migration.match(/\$function\$/g)).toHaveLength(2)
    expect(migration).toContain("'exact_unique_text', 'exact_frozen_chunk'")
    expect(migration).toContain("coalesce(risk.evidence->>'source_anchor_status', '') not in")
    expect(migration).toContain("source_chunk_hash")
    expect(migration).toContain("invocation.status = 'completed'")
    expect(migration).toContain('invocation.degraded is false')
    expect(migration).toContain("invocation.request_meta#>>'{metadata,chunk_hash}'")
    expect(migration).toContain("extensions.digest(")
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
  })

  it('validates each frozen chunk anchor without repeatedly scanning the full source', () => {
    const migration = withoutLineComments(readMigration(frozenChunkAnchorPerformanceName))

    expect(migration).toContain(
      'create or replace function public.contract_direct_source_anchor_is_valid(',
    )
    expect(migration.match(/\$function\$/g)).toHaveLength(2)
    expect(migration).toContain('current_parsed_text_utf16_length')
    expect(migration).toContain('current_parsed_text_all_bmp')
    expect(migration).toContain('when p_source_all_bmp')
    expect(migration).toContain('then pg_catalog.substr(')
    expect(migration).toContain("invocation.phase = 'semantic_review'")
    expect(migration).toContain("invocation.status = 'completed'")
    expect(migration).toContain('invocation.degraded is false')
    expect(migration).toContain(
      "invocation.provider is not distinct from p_evidence->>'provider'",
    )
    expect(migration).toContain('public.contract_direct_source_anchor_is_valid(')
    expect(migration).toContain(') is distinct from true')
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
  })

  it('starts only an explicitly frozen deterministic Preview candidate', () => {
    const creator = withoutLineComments(readMigration(deterministicCandidateCreateName))
    const migration = withoutLineComments(readMigration(deterministicCandidateStartName))

    expect(deterministicCandidateCreateName.localeCompare(deterministicCandidateStartName))
      .toBeLessThan(0)
    expect(creator).toContain('v_output_schema constant jsonb')
    expect(creator).toContain('"contract":"contract_review_facts_v1"')
    expect(creator).toContain('"manifest_hash":"da8c818aeed5bd7abef2b3b9a28721a1ef9d10deb08ff0ac2eeb91d930fbf5e7"')
    expect(creator).toContain("'stages', jsonb_build_array('fact_extraction')")
    expect(creator).toContain("'provider_kind', 'lm_studio'")
    expect(creator).toContain(
      "'source_config_ids', jsonb_build_array(v_qwen_config.id, v_gemma_config.id)",
    )
    expect(creator).toContain("job.status in ('preparing', 'queued', 'running')")
    expect(creator).toContain("raise exception 'PREVIEW_CANDIDATE_HAS_ACTIVE_REVIEW'")
    expect(creator).toContain('from service_role;')
    expect(creator).toContain(
      'revoke all on table public.contract_skill_bundle_channels from service_role',
    )
    expect(migration).toContain(
      'create or replace function public.start_contract_analysis_candidate_job_v1(',
    )
    expect(migration).toContain("channel.channel = 'preview_candidate'")
    expect(migration).toContain('bundle.id = channel.bundle_id')
    expect(migration).toContain('bundle.version = channel.bundle_version')
    expect(migration).toContain('for share of channel, bundle')
    expect(migration).toContain('or v_bundle.is_current')
    expect(migration).toContain("v_bundle.release_meta->>'stage' <> 'candidate'")
    expect(migration).toContain("v_bundle.release_meta->>'release_eligible' <> 'false'")
    expect(migration).toContain('{"contract":"contract_review_facts_v1","version":1}')
    expect(migration).toContain(
      "v_bundle.output_schema->>'manifest_hash'",
    )
    expect(migration).toContain(
      'da8c818aeed5bd7abef2b3b9a28721a1ef9d10deb08ff0ac2eeb91d930fbf5e7',
    )
    expect(migration).toContain('pg_catalog.cardinality(v_bundle.rule_snapshot_ids) <> 15')
    expect(migration).toContain("'R001', 'R002', 'R003', 'R004', 'R005'")
    expect(migration).toContain("'R011', 'R012', 'R013', 'R014', 'R015'")
    expect(migration).toContain("in ('ignore', 'yellow_review', 'red_risk')")
    expect(migration).toContain("policy.status = 'published'")
    expect(migration).toContain("provider.entry->'stages' @> '[\"fact_extraction\"]'::jsonb")
    expect(migration).toContain("provider.entry->>'provider_kind', '')) <> 'lm_studio'")
    expect(migration).toContain("provider.entry->>'runtime_location', '')) <> 'local'")
    expect(migration).toContain("provider.entry->>'data_boundary', '')) <> 'local_only'")
    expect(migration).toContain("config.value->>'provider_kind' = 'lm_studio'")
    expect(migration).toContain('127[.]0[.]0[.]1|localhost|\\[::1\\]')
    expect(migration).toContain("config.value->>'api_key'")
    expect(migration).toContain("config.value->>'cost_tracking'")
    expect(migration).toContain("provider.entry->>'source_config_id'")
    expect(migration).toContain('pg_catalog.to_jsonb(v_policy.source_config_ids)')
    expect(migration).toContain('insert into public.contract_reviews')
    expect(migration).toContain('v_bundle.rule_snapshot_ids')
    expect(migration).toContain('v_bundle.rule_set_snapshot_ids')
    expect(migration).toContain('v_bundle.model_policy_id')
    expect(migration).toContain('insert into public.contract_analysis_jobs')
    expect(migration).toContain("'queued'")
    expect(migration).toContain("set status = 'PARSING'")
    expect(migration).toMatch(
      /start_contract_analysis_candidate_job_v1\([\s\S]*?from public, anon, authenticated, service_role;/,
    )
    expect(migration).toMatch(
      /grant execute on function public\.start_contract_analysis_candidate_job_v1\([\s\S]*?to service_role;/,
    )
    expect(migration).not.toContain('public.start_contract_analysis_job(')
    expect(migration).not.toContain("channel.channel = 'release_current'")
    expect(migration).toContain("p_org_id::text || ':CONTRACT_REVIEW_DEFAULT'")
    expect(migration).not.toMatch(/update public\.contract_skill_bundle_channels/i)
    expect(migration).not.toMatch(/update public\.contract_skill_bundles/i)
  })

  it('repairs only whitespace-equivalent Word projections through an immutable service-only audit', () => {
    const migration = withoutLineComments(readMigration(sourceTextRepairName))
    const membershipFix = withoutLineComments(readMigration(sourceTextRepairMembershipFixName))
    const pageRangeFix = withoutLineComments(readMigration(sourceTextRepairPageRangeFixName))
    const registry = readFileSync(resolve(process.cwd(), '../REQ_REGISTRY.yml'), 'utf8')

    expect(deterministicCandidateStartName.localeCompare(sourceTextRepairName)).toBeLessThan(0)
    expect(sourceTextRepairName.localeCompare(sourceTextRepairMembershipFixName)).toBeLessThan(0)
    expect(sourceTextRepairMembershipFixName.localeCompare(sourceTextRepairPageRangeFixName)).toBeLessThan(0)
    expect(migration).toContain('create table public.contract_source_text_repair_audits')
    expect(migration).toContain('old_parsed_text text not null')
    expect(migration).toContain('old_page_map jsonb not null')
    expect(migration).toContain('request_id uuid not null unique')
    expect(migration).toContain('before update or delete on public.contract_source_text_repair_audits')
    expect(migration).toContain('create or replace function public.reconcile_word_source_text_projection_v1(')
    expect(migration).toContain('for update of contract')
    expect(migration).toContain('for update of page_map')
    expect(migration).toContain("job.status in ('preparing', 'queued', 'running')")
    expect(migration).toContain("review.status in ('PARSING', 'ANALYZING')")
    expect(migration).toContain('SOURCE_TEXT_REPAIR_CONTENT_CHANGED')
    expect(migration).toContain('SOURCE_TEXT_REPAIR_MUTABLE_ASSETS_EXIST')
    expect(migration).toContain('from public.contract_annotations as annotation')
    expect(migration).toContain("draft.status = 'draft_selected'")
    expect(migration).toContain("'[[:space:]]+', '', 'g'")
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
    expect(membershipFix).toContain('from public.users as actor')
    expect(membershipFix).toContain('join public.user_organizations as membership')
    expect(membershipFix).not.toContain('public.organization_members')
    expect(pageRangeFix).toContain("'end', greatest(0, v_new_text_utf16_length - 1)")
    expect(pageRangeFix).not.toContain('pg_catalog.greatest')
    expect(registry).toContain(`supabase/migrations/${sourceTextRepairName}`)
    expect(registry).toContain(`supabase/migrations/${sourceTextRepairMembershipFixName}`)
    expect(registry).toContain(`supabase/migrations/${sourceTextRepairPageRangeFixName}`)
  })

  it('clones v22 into an auditable Preview-only runtime calibration candidate', () => {
    const migration = withoutLineComments(readMigration(runtimeCalibrationName))
    const cloneGuardFix = withoutLineComments(readMigration(runtimeCalibrationFixName))

    expect(sourceTextRepairPageRangeFixName.localeCompare(runtimeCalibrationName)).toBeLessThan(0)
    expect(runtimeCalibrationName.localeCompare(runtimeCalibrationFixName)).toBeLessThan(0)
    expect(migration).toContain(
      'create or replace function public.create_preview_runtime_calibration_candidate_v1(',
    )
    expect(migration).toContain("channel.channel = 'preview_candidate'")
    expect(migration).toContain('channel.bundle_id = p_expected_bundle_id')
    expect(migration).toContain('channel.bundle_version = p_expected_bundle_version')
    expect(migration).toContain('for update of channel, bundle')
    expect(migration).toContain("job.status in ('preparing', 'queued', 'running')")
    expect(migration).toContain("review.status in ('PARSING', 'ANALYZING')")
    expect(migration).toContain("(entry.value->>'timeout_ms')::integer = 45000")
    expect(migration).toContain('v_target_bundle_version constant integer := 23')
    expect(migration).toContain('v_target_policy_version constant integer := 3')
    expect(migration).toContain('v_qwen_timeout_ms constant integer := 60000')
    expect(migration).toContain('v_gemma_timeout_ms constant integer := 75000')
    expect(migration).toContain('v_policy_timeout_ms constant integer := 75000')
    expect(migration).toContain("jsonb_build_object('timeout_ms', v_qwen_timeout_ms)")
    expect(migration).toContain("jsonb_build_object('timeout_ms', v_gemma_timeout_ms)")
    expect(migration).toContain("'timeout_ms', v_policy_timeout_ms")
    expect(migration).toContain("'transport_schema', 'facts-v1-compact-rule-enum.v1'")
    expect(migration).toContain('public.contract_canonical_json_v1(to_jsonb(v_base_bundle))')
    expect(migration).toContain('public.contract_canonical_json_v1(to_jsonb(v_base_policy))')
    expect(migration).toContain("invocation.phase = 'fact_extraction'")
    expect(migration).toContain('p_expected_config_manifest_hash')
    expect(migration).toContain('p_expected_invocation_manifest_hash')
    expect(migration).toContain('PREVIEW_RUNTIME_CALIBRATION_POLICY_CLONE_DRIFT')
    expect(migration).toContain('PREVIEW_RUNTIME_CALIBRATION_BUNDLE_CLONE_DRIFT')
    expect(migration).toContain('PREVIEW_RUNTIME_CALIBRATION_POSTFLIGHT_INVALID')
    expect(migration).toContain('v_base_bundle.rule_snapshot_ids')
    expect(migration).toContain('v_base_bundle.rule_set_snapshot_ids')
    expect(migration).toContain('v_base_bundle.output_schema')
    expect(migration).toContain("'source_bundle_id', v_base_bundle.id")
    expect(migration).toContain("'source_compiled_hash', v_base_bundle.compiled_hash")
    expect(migration).toContain("'release_eligible', false")
    expect(migration).toContain("and channel = 'preview_candidate'")
    expect(migration).toContain('and bundle_id = p_expected_bundle_id')
    expect(migration).toContain('and bundle_version = p_expected_bundle_version')
    expect(migration).toContain('PREVIEW_RUNTIME_CALIBRATION_IDEMPOTENCY_CONFLICT')
    expect(migration.indexOf('insert into public.model_policies')).toBeLessThan(
      migration.indexOf('insert into public.contract_skill_bundles'),
    )
    expect(migration.indexOf('insert into public.contract_skill_bundles')).toBeLessThan(
      migration.indexOf('update public.contract_skill_bundle_channels'),
    )
    expect(migration).toMatch(
      /create_preview_runtime_calibration_candidate_v1\([\s\S]*?from public, anon, authenticated, service_role;/,
    )
    expect(migration).toMatch(
      /grant execute on function public\.create_preview_runtime_calibration_candidate_v1\([\s\S]*?to service_role;/,
    )
    expect(migration).not.toMatch(/update public\.configs/i)
    expect(migration).not.toMatch(/update public\.model_policies/i)
    expect(migration).not.toMatch(/update public\.contract_skill_bundles/i)
    expect(migration).not.toMatch(
      /update public\.contract_skill_bundle_channels[^;]*channel = 'release_current'/i,
    )
    expect(cloneGuardFix).toContain('pg_catalog.pg_get_functiondef(v_function_oid)')
    expect(cloneGuardFix).toContain("'compiled_at', 'published_at', 'updated_at'")
    expect(cloneGuardFix).toContain(
      "'compiled_at', 'published_at', 'created_at', 'updated_at'",
    )
    expect(cloneGuardFix).toContain('v_occurrences <> 2')
    expect(cloneGuardFix).toContain('PREVIEW_RUNTIME_CALIBRATION_CLONE_GUARD_PATCH_FAILED')
  })
})
