import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { scorePredictions, validateGold } from './score-g5-accuracy.mjs'

const gold = JSON.parse(await readFile(new URL('./g5-50-page-gold-manifest.v1.json', import.meta.url), 'utf8'))
const snapshotId = '11111111-1111-4111-8111-111111111111'

function exactPrediction(label) {
  return {
    page: label.page,
    rule_code: label.rule_code,
    rule_snapshot_id: snapshotId,
    source_quote: label.exact_clause_text,
    source_start: label.source_span_utf16.start,
    source_end: label.source_span_utf16.end,
  }
}

test('gold manifest has 50 unique, internally consistent labels', () => {
  assert.equal(validateGold(gold), gold)
  assert.equal(new Set(gold.labels.map((label) => label.id)).size, 50)
  assert.equal(new Set(gold.labels.map((label) => label.rule_code)).size, 10)
  assert.deepEqual([...new Set(gold.labels.map((label) => label.page))], Array.from({ length: 50 }, (_, index) => index + 1))
})

test('perfect predictions score 1.0 for detection, macro recall, and anchors', () => {
  const score = scorePredictions(gold, { predictions: gold.labels.map(exactPrediction) })
  assert.deepEqual(score.counts, {
    gold: 50,
    predictions: 50,
    true_positive: 50,
    false_positive: 0,
    false_negative: 0,
  })
  assert.equal(score.metrics.precision, 1)
  assert.equal(score.metrics.recall, 1)
  assert.equal(score.metrics.f1, 1)
  assert.equal(score.metrics.macro_recall, 1)
  assert.equal(score.metrics.anchor_exactness, 1)
  assert.equal(score.diagnostics.duplicate_count, 0)
  assert.equal(score.diagnostics.unbound_count, 0)
})

test('reports duplicates, false positives, unbound rules, and non-exact anchors separately', () => {
  const first = gold.labels[0]
  const second = gold.labels[1]
  const predictions = [
    exactPrediction(first),
    exactPrediction(first),
    {
      ...exactPrediction(second),
      rule_snapshot_id: undefined,
      source_quote: `${second.exact_clause_text}（错误扩张）`,
    },
    {
      page: 999,
      rule_code: 'R999',
      source_quote: '不存在的风险',
    },
  ]
  const score = scorePredictions(gold, { result: { risks: predictions } })
  assert.equal(score.counts.true_positive, 2)
  assert.equal(score.counts.false_positive, 2)
  assert.equal(score.counts.false_negative, 48)
  assert.equal(score.metrics.precision, 0.5)
  assert.equal(score.metrics.recall, 0.04)
  assert.equal(score.metrics.anchor_exactness, 0.5)
  assert.equal(score.diagnostics.duplicate_count, 1)
  assert.equal(score.diagnostics.unbound_count, 2)
  assert.equal(score.diagnostics.unbound_rule_code_count, 0)
  assert.equal(score.diagnostics.unbound_rule_snapshot_id_count, 2)
})

test('infers a missing page only from an exact rule and UTF-16 span', () => {
  const label = gold.labels[20]
  const prediction = exactPrediction(label)
  delete prediction.page
  const score = scorePredictions(gold, [prediction])
  assert.equal(score.counts.true_positive, 1)
  assert.equal(score.diagnostics.inferred_page_from_exact_span_count, 1)
  assert.equal(score.metrics.anchor_exactness, 1)
})
