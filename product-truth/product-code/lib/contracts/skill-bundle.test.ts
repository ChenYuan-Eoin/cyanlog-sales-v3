import { describe, expect, it } from 'vitest'
import { isContractSkillBundleFormalReviewAllowed } from './skill-bundle'

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
        rule_set_document_gate: {
          status: 'ready',
        },
        eval_results: {
          status: 'failed',
        },
      },
    }))).toBe(false)
  })

  it('rejects bundles without published translated rule-set documents', () => {
    expect(isContractSkillBundleFormalReviewAllowed(formalBundle({
      compiled_from: {
        rule_translation_gate: {
          status: 'ready',
          official_review_allowed: true,
        },
        rule_set_document_gate: {
          status: 'failed',
          blocking_reasons: ['ruleset_document_missing:PAYMENT'],
        },
        eval_results: {
          status: 'passed',
        },
      },
    }))).toBe(false)
  })
})
