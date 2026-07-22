import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { scoreRiskPredictions, validateRiskGold } from './score-g5-risk-accuracy-v2.mjs'

const gold = JSON.parse(await readFile(new URL('./g5-50-page-risk-gold-manifest.v2.json', import.meta.url), 'utf8'))
const snapshotId = '00000000-0000-4000-8000-000000000001'
const prediction = entry => ({
  rule_code: entry.rule_code,
  rule_snapshot_id: snapshotId,
  level: entry.expected_level,
  source_quote: entry.exact_clause_text,
  source_start: entry.source_span_utf16.start,
  source_end: entry.source_span_utf16.end,
})

test('validates the corrected 45-positive and 5-negative gold contract', () => {
  assert.equal(validateRiskGold(gold), gold)
})

test('scores exact positive predictions without rewarding the no-risk clauses', () => {
  const score = scoreRiskPredictions(gold, { predictions: gold.labels.map(prediction) })
  assert.equal(score.metrics.precision, 1)
  assert.equal(score.metrics.recall, 1)
  assert.equal(score.metrics.anchor_exactness, 1)
  assert.equal(score.metrics.severity_accuracy, 1)
  assert.equal(score.metrics.explicit_negative_specificity, 1)
  assert.equal(score.diagnostics.inferred_page_from_exact_span_count, 45)
})

test('treats a risk prediction on a published Level A no-risk clause as false positive', () => {
  const negative = gold.negative_cases[0]
  const score = scoreRiskPredictions(gold, {
    predictions: [
      ...gold.labels.map(prediction),
      {
        rule_code: negative.rule_code,
        rule_snapshot_id: snapshotId,
        level: 'yellow',
        source_quote: negative.exact_clause_text,
        source_start: negative.source_span_utf16.start,
        source_end: negative.source_span_utf16.end,
      },
    ],
  })
  assert.equal(score.counts.false_positive, 1)
  assert.equal(score.counts.explicit_negative_hits, 1)
  assert.equal(score.metrics.explicit_negative_specificity, 0.8)
})

test('scores severity independently from risk detection and source anchoring', () => {
  const predictions = gold.labels.map(prediction)
  predictions[0].level = predictions[0].level === 'red' ? 'yellow' : 'red'
  const score = scoreRiskPredictions(gold, { predictions })
  assert.equal(score.metrics.recall, 1)
  assert.equal(score.metrics.anchor_exactness, 1)
  assert.equal(score.metrics.severity_accuracy, 0.977778)
  assert.equal(score.diagnostics.severity_mismatches.length, 1)
})
