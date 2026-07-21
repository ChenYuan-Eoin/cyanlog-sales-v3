import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

import {
  getOrCompilePublishedContractSkillBundle,
  isContractSkillBundleFormalReviewAllowed,
} from './skill-bundle'

const skillBundleSource = readFileSync(join(process.cwd(), 'lib/contracts/skill-bundle.ts'), 'utf8')

function queryResult(data: unknown[], error: { message: string } | null = null) {
  const result = { data, error }
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    not: vi.fn(),
    in: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
      Promise.resolve(result).then(resolve, reject)
    ),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.not.mockReturnValue(chain)
  chain.in.mockReturnValue(chain)
  return chain
}

function formalBundle(overrides: Record<string, unknown> = {}) {
  return {
    status: 'published',
    is_current: true,
    published_at: '2026-07-02T00:00:00.000Z',
    release_meta: {
      official_review_allowed: true,
    },
    compiled_from: {
      rule_translation_gate: {
        status: 'ready',
        official_review_allowed: true,
      },
      rule_set_snapshot_gate: {
        status: 'ready',
      },
      rule_set_document_gate: {
        status: 'ready',
      },
      eval_results: {
        status: 'passed',
      },
    },
    ...overrides,
  }
}

describe('SkillBundle formal review gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('compiles rule assets independently from AI routes and legacy ModelPolicy', () => {
    expect(skillBundleSource).not.toContain('resolvePublishedModelPolicy')
    expect(skillBundleSource).not.toContain("@/lib/contracts/model-policy")
    expect(skillBundleSource).not.toContain('provider_chain: modelPolicy')
    expect(skillBundleSource).toContain('model_policy_id: null')
  })

  it('only consumes atomic ruleset snapshots and never becomes a second ruleset publisher', () => {
    expect(skillBundleSource).toContain('loadPublishedRuleSetSnapshots')
    expect(skillBundleSource).toContain(".from('contract_rule_sets')")
    expect(skillBundleSource).toContain('current_snapshot_id')
    expect(skillBundleSource).toContain(".from('contract_rule_set_snapshots')")
    expect(skillBundleSource).toContain(".in('id', currentSnapshotIds)")
    expect(skillBundleSource).toContain('RULESET_CURRENT_POINTER_STATE_INVALID')
    expect(skillBundleSource).toContain('RULESET_CURRENT_SNAPSHOT_INVALID')
    expect(skillBundleSource).toContain('RULESET_CURRENT_MEMBERSHIP_INVALID')
    expect(skillBundleSource).not.toContain(".from('contract_rule_set_snapshots')\n    .upsert")
    const pointerLoader = skillBundleSource.slice(
      skillBundleSource.indexOf('async function loadPublishedRuleSetSnapshots'),
      skillBundleSource.indexOf('function summarizeRuleSetSnapshotGate')
    )
    expect(pointerLoader).not.toContain(".order('released_at'")
    expect(pointerLoader).not.toContain(".in('rule_set_id'")
    expect(pointerLoader).not.toContain(".not('published_at'")
  })

  it('fails closed when current snapshot pointer and published_at disagree', async () => {
    mocks.from.mockReturnValue(queryResult([{
      id: 'set-1',
      org_id: 'org-1',
      current_snapshot_id: 'set-snapshot-1',
      published_at: null,
    }]))

    await expect(getOrCompilePublishedContractSkillBundle({ orgId: 'org-1' })).rejects.toThrow(
      'RULESET_CURRENT_POINTER_STATE_INVALID:set-1'
    )
  })

  it('fails closed for each malformed current RuleSet membership', async () => {
    for (const memberIds of [
      [],
      ['snapshot-1', ''],
      ['snapshot-1', 'snapshot-1'],
    ]) {
      vi.clearAllMocks()
      const pointerQuery = queryResult([{
        id: 'set-1', org_id: 'org-1', current_snapshot_id: 'set-snapshot-1',
        published_at: '2026-07-20T00:00:00.000Z',
      }])
      const snapshotQuery = queryResult([{
        id: 'set-snapshot-1', org_id: 'org-1', rule_set_id: 'set-1', version: 1,
        status: 'published', rule_snapshot_ids: memberIds, document_snapshot_ids: [],
        config_snapshot: {}, released_at: '2026-07-20T00:00:00.000Z',
      }])
      mocks.from.mockImplementation((table: string) => {
        if (table === 'contract_rule_sets') return pointerQuery
        if (table === 'contract_rule_set_snapshots') return snapshotQuery
        throw new Error(`unexpected table: ${table}`)
      })

      await expect(getOrCompilePublishedContractSkillBundle({ orgId: 'org-1' })).rejects.toThrow(
        'RULESET_CURRENT_MEMBERSHIP_INVALID:set-1'
      )
    }
  })

  it('allows only published current bundles with translation and eval gates passed', () => {
    expect(isContractSkillBundleFormalReviewAllowed(formalBundle())).toBe(true)
  })

  it('rejects published-looking bundles when eval evidence is missing', () => {
    expect(isContractSkillBundleFormalReviewAllowed(formalBundle({
      compiled_from: {
        rule_translation_gate: {
          status: 'ready',
          official_review_allowed: true,
        },
        rule_set_snapshot_gate: {
          status: 'ready',
        },
        rule_set_document_gate: {
          status: 'ready',
        },
        eval_results: {
          status: 'runtime_eval_not_run',
        },
      },
    }))).toBe(false)
  })

  it('rejects bundles that were compiled but not formally published', () => {
    expect(isContractSkillBundleFormalReviewAllowed(formalBundle({
      status: 'compiled',
      is_current: false,
      published_at: null,
      release_meta: {
        official_review_allowed: false,
      },
    }))).toBe(false)
  })

  it('rejects bundles when rule translation still needs confirmation', () => {
    expect(isContractSkillBundleFormalReviewAllowed(formalBundle({
      compiled_from: {
        rule_translation_gate: {
          status: 'needs_ai_translation',
          official_review_allowed: false,
          blocking_reasons: ['rule_translation_needs_confirmation'],
        },
        rule_set_snapshot_gate: {
          status: 'ready',
        },
        rule_set_document_gate: {
          status: 'ready',
        },
        eval_results: {
          status: 'failed',
        },
      },
    }))).toBe(false)
  })

  it('allows an otherwise complete bundle when optional ruleset reference documents are absent', () => {
    expect(isContractSkillBundleFormalReviewAllowed(formalBundle({
      compiled_from: {
        rule_translation_gate: {
          status: 'ready',
          official_review_allowed: true,
        },
        rule_set_snapshot_gate: {
          status: 'ready',
        },
        rule_set_document_gate: {
          status: 'ready',
          total_rule_sets: 1,
          ready_documents: 0,
          blocking_reasons: [],
        },
        eval_results: {
          status: 'passed',
        },
      },
    }))).toBe(true)
  })

  it('rejects bundles when SkillBundle has no atomic published ruleset snapshot to consume', () => {
    expect(isContractSkillBundleFormalReviewAllowed(formalBundle({
      compiled_from: {
        rule_translation_gate: {
          status: 'ready',
          official_review_allowed: true,
        },
        rule_set_snapshot_gate: {
          status: 'failed',
          blocking_reasons: ['published_rule_set_snapshot_missing:set-1'],
        },
        rule_set_document_gate: {
          status: 'ready',
        },
        eval_results: {
          status: 'passed',
        },
      },
    }))).toBe(false)
  })
})
