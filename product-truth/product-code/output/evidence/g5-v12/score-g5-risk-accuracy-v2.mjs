#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const DEFAULT_GOLD = new URL('./g5-50-page-risk-gold-manifest.v2.json', import.meta.url)

const stringValue = value => typeof value === 'string' && value.trim() ? value.trim() : null
const integerValue = value => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isSafeInteger(parsed) ? parsed : null
}
const first = (...values) => values.find(value => value !== undefined && value !== null)
const ratio = (numerator, denominator) => denominator === 0 ? 0 : numerator / denominator
const rounded = value => Number(value.toFixed(6))

function predictionArray(payload) {
  if (Array.isArray(payload)) return payload
  const value = [payload?.predictions, payload?.risks, payload?.result?.risks, payload?.data?.riskCards].find(Array.isArray)
  if (!value) throw new Error('预测 JSON 缺少 predictions/risks 数组')
  return value
}

function normalizePrediction(raw, index) {
  const evidence = raw?.evidence && typeof raw.evidence === 'object' ? raw.evidence : {}
  const direct = raw?.source_anchor && typeof raw.source_anchor === 'object' ? raw.source_anchor : {}
  const nested = evidence?.source_anchor && typeof evidence.source_anchor === 'object' ? evidence.source_anchor : {}
  return {
    index,
    raw,
    rule_code: stringValue(first(raw?.rule_code, raw?.ruleCode, raw?.rule?.code)),
    rule_snapshot_id: stringValue(first(raw?.rule_snapshot_id, raw?.ruleSnapshotId, raw?.rule?.snapshot_id)),
    level: stringValue(first(raw?.level, raw?.risk_level)),
    page: integerValue(first(raw?.page, raw?.page_number, direct.page, nested.page)),
    exact_clause_text: stringValue(first(raw?.source_quote, raw?.exact_clause_text, direct.exact_text, nested.exact_text)),
    start: integerValue(first(raw?.source_start, raw?.start, direct.start, nested.start)),
    end: integerValue(first(raw?.source_end, raw?.end, direct.end, nested.end)),
    page_source: 'explicit',
  }
}

function validateCase(entry, kind, index) {
  const id = stringValue(entry?.id)
  const ruleCode = stringValue(entry?.rule_code)
  const page = integerValue(entry?.page)
  const text = typeof entry?.exact_clause_text === 'string' ? entry.exact_clause_text : null
  const start = integerValue(entry?.source_span_utf16?.start)
  const end = integerValue(entry?.source_span_utf16?.end)
  if (!id || !ruleCode || !page || !text || start === null || end === null || end <= start || end - start !== text.length) {
    throw new Error(`${kind} 第 ${index + 1} 条字段或 UTF-16 span 无效`)
  }
  if (entry.page_marker !== `PAGE-${String(page).padStart(2, '0')}-ANCHOR-${String(page).padStart(2, '0')}`) {
    throw new Error(`${kind} ${id} 的页标记无效`)
  }
  return entry
}

export function validateRiskGold(gold) {
  if (gold?.schema_version !== 'g5-risk-accuracy-gold.v2') throw new Error('gold schema 不是 g5-risk-accuracy-gold.v2')
  if (!Array.isArray(gold.labels) || gold.labels.length !== 45) throw new Error('gold 必须包含 45 个正例')
  if (!Array.isArray(gold.negative_cases) || gold.negative_cases.length !== 5) throw new Error('gold 必须包含 5 个明确负例')
  const identities = new Set()
  gold.labels.forEach((entry, index) => {
    validateCase(entry, 'positive', index)
    if (!['red', 'yellow', 'green'].includes(entry.expected_level)) throw new Error(`positive ${entry.id} 缺少 expected_level`)
    const identity = `${entry.page}|${entry.rule_code}`
    if (identities.has(identity)) throw new Error(`gold identity 重复: ${identity}`)
    identities.add(identity)
  })
  gold.negative_cases.forEach((entry, index) => {
    validateCase(entry, 'negative', index)
    if (entry.expected_outcome !== 'no_risk') throw new Error(`negative ${entry.id} 不是 no_risk`)
    const identity = `${entry.page}|${entry.rule_code}`
    if (identities.has(identity)) throw new Error(`gold identity 重复: ${identity}`)
    identities.add(identity)
  })
  return gold
}

function inferPage(prediction, cases) {
  if (prediction.page !== null || prediction.start === null || prediction.end === null || !prediction.rule_code) return prediction
  const matches = cases.filter(entry => (
    entry.rule_code === prediction.rule_code
    && entry.source_span_utf16.start === prediction.start
    && entry.source_span_utf16.end === prediction.end
  ))
  return matches.length === 1
    ? { ...prediction, page: matches[0].page, page_source: 'exact_span' }
    : { ...prediction, page_source: 'missing' }
}

export function scoreRiskPredictions(goldInput, predictionPayload) {
  const gold = validateRiskGold(goldInput)
  const allCases = [...gold.labels, ...gold.negative_cases]
  const predictions = predictionArray(predictionPayload)
    .map(normalizePrediction)
    .map(prediction => inferPage(prediction, allCases))
  const positiveByIdentity = new Map(gold.labels.map(entry => [`${entry.page}|${entry.rule_code}`, entry]))
  const negativeByIdentity = new Map(gold.negative_cases.map(entry => [`${entry.page}|${entry.rule_code}`, entry]))
  const matchedPositiveIds = new Set()
  const hitNegativeIds = new Set()
  const identityCounts = new Map()
  const matches = []
  const falsePositives = []

  for (const prediction of predictions) {
    const identity = prediction.page !== null && prediction.rule_code ? `${prediction.page}|${prediction.rule_code}` : null
    if (identity) identityCounts.set(identity, (identityCounts.get(identity) || 0) + 1)
    const positive = identity ? positiveByIdentity.get(identity) : null
    const negative = identity ? negativeByIdentity.get(identity) : null
    if (positive && !matchedPositiveIds.has(positive.id)) {
      matchedPositiveIds.add(positive.id)
      matches.push({
        prediction,
        gold: positive,
        quote_exact: prediction.exact_clause_text === positive.exact_clause_text,
        span_exact: prediction.start === positive.source_span_utf16.start && prediction.end === positive.source_span_utf16.end,
        severity_exact: prediction.level === positive.expected_level,
      })
    } else {
      if (negative) hitNegativeIds.add(negative.id)
      falsePositives.push({
        prediction_index: prediction.index,
        identity,
        reason: negative ? 'explicit_no_risk_case' : positive ? 'duplicate_detection' : 'no_positive_gold_match',
      })
    }
  }

  const tp = matches.length
  const fp = falsePositives.length
  const fn = gold.labels.length - tp
  const precision = ratio(tp, tp + fp)
  const recall = ratio(tp, gold.labels.length)
  const anchorExact = matches.filter(match => match.quote_exact && match.span_exact).length
  const severityExact = matches.filter(match => match.severity_exact).length
  const duplicateCount = [...identityCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
  const ruleCodes = [...new Set(gold.labels.map(entry => entry.rule_code))].sort()
  const perRule = Object.fromEntries(ruleCodes.map(ruleCode => {
    const ruleGold = gold.labels.filter(entry => entry.rule_code === ruleCode)
    const matched = matches.filter(match => match.gold.rule_code === ruleCode)
    return [ruleCode, {
      gold: ruleGold.length,
      matched: matched.length,
      recall: rounded(ratio(matched.length, ruleGold.length)),
      severity_accuracy: rounded(ratio(matched.filter(match => match.severity_exact).length, matched.length)),
    }]
  }))

  return {
    schema_version: 'g5-risk-accuracy-score.v2',
    benchmark_id: gold.benchmark_id,
    counts: {
      positive_gold: gold.labels.length,
      explicit_negative_gold: gold.negative_cases.length,
      predictions: predictions.length,
      true_positive: tp,
      false_positive: fp,
      false_negative: fn,
      explicit_negative_hits: hitNegativeIds.size,
    },
    metrics: {
      precision: rounded(precision),
      recall: rounded(recall),
      f1: rounded(precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)),
      anchor_exactness: rounded(ratio(anchorExact, tp)),
      severity_accuracy: rounded(ratio(severityExact, tp)),
      explicit_negative_specificity: rounded(ratio(gold.negative_cases.length - hitNegativeIds.size, gold.negative_cases.length)),
    },
    diagnostics: {
      duplicate_count: duplicateCount,
      unbound_count: predictions.filter(prediction => !prediction.rule_code || !prediction.rule_snapshot_id).length,
      unlocated_count: predictions.filter(prediction => prediction.page === null).length,
      inferred_page_from_exact_span_count: predictions.filter(prediction => prediction.page_source === 'exact_span').length,
      false_positives: falsePositives,
      unmatched_positive_ids: gold.labels.filter(entry => !matchedPositiveIds.has(entry.id)).map(entry => entry.id),
      hit_negative_ids: gold.negative_cases.filter(entry => hitNegativeIds.has(entry.id)).map(entry => entry.id),
      severity_mismatches: matches.filter(match => !match.severity_exact).map(match => ({
        id: match.gold.id,
        expected: match.gold.expected_level,
        actual: match.prediction.level,
      })),
    },
    per_rule: perRule,
    release_acceptance: false,
    definitions: {
      positive_match: 'one-to-one exact page + rule_code; page may be inferred only from exact rule_code + UTF-16 span',
      explicit_negative: 'published Level A no-risk clause; any risk prediction on its exact identity is a false positive',
      severity_accuracy: 'exact red/yellow/green match among true-positive risk detections',
    },
  }
}

async function main() {
  const predictionArg = process.argv[2]
  const goldArg = process.argv[3]
  if (!predictionArg) throw new Error('用法: node score-g5-risk-accuracy-v2.mjs <predictions.json> [gold.json]')
  const [gold, predictions] = await Promise.all([
    readFile(goldArg || DEFAULT_GOLD, 'utf8').then(JSON.parse),
    readFile(predictionArg, 'utf8').then(JSON.parse),
  ])
  process.stdout.write(`${JSON.stringify(scoreRiskPredictions(gold, predictions), null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
