#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_GOLD = new URL('./g5-50-page-gold-manifest.v1.json', import.meta.url)

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null)
}

function asString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asInteger(value) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isSafeInteger(parsed) ? parsed : null
}

function readAnchor(raw) {
  const evidence = raw?.evidence && typeof raw.evidence === 'object' ? raw.evidence : {}
  const direct = raw?.source_anchor && typeof raw.source_anchor === 'object' ? raw.source_anchor : {}
  const nested = evidence?.source_anchor && typeof evidence.source_anchor === 'object' ? evidence.source_anchor : {}
  return { direct, nested }
}

function predictionArray(payload) {
  if (Array.isArray(payload)) return payload
  const candidates = [
    payload?.predictions,
    payload?.risks,
    payload?.result?.risks,
    payload?.data?.risks,
    payload?.data?.riskCards,
  ]
  const value = candidates.find(Array.isArray)
  if (!value) throw new Error('预测 JSON 必须是数组，或包含 predictions/risks/result.risks/data.risks/data.riskCards 数组')
  return value
}

function normalizePrediction(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      index,
      raw,
      rule_code: null,
      rule_snapshot_id: null,
      page: null,
      exact_clause_text: null,
      start: null,
      end: null,
      page_source: 'missing',
    }
  }
  const { direct, nested } = readAnchor(raw)
  return {
    index,
    raw,
    rule_code: asString(firstDefined(raw.rule_code, raw.ruleCode, raw.rule?.code)),
    rule_snapshot_id: asString(firstDefined(
      raw.rule_snapshot_id,
      raw.ruleSnapshotId,
      raw.rule_snapshot?.id,
      raw.rule?.snapshot_id,
    )),
    page: asInteger(firstDefined(
      raw.page,
      raw.page_number,
      raw.pageNumber,
      direct.page,
      direct.page_number,
      nested.page,
      nested.page_number,
    )),
    exact_clause_text: asString(firstDefined(
      raw.source_quote,
      raw.exact_clause_text,
      raw.exact_text,
      direct.exact_text,
      direct.source_quote,
      nested.exact_text,
      nested.source_quote,
    )),
    start: asInteger(firstDefined(
      raw.source_start,
      raw.start_offset,
      raw.start,
      direct.start,
      direct.start_offset,
      nested.start,
      nested.start_offset,
    )),
    end: asInteger(firstDefined(
      raw.source_end,
      raw.end_offset,
      raw.end,
      direct.end,
      direct.end_offset,
      nested.end,
      nested.end_offset,
    )),
    page_source: 'explicit',
  }
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator
}

function rounded(value) {
  return Number(value.toFixed(6))
}

export function validateGold(gold) {
  if (!gold || typeof gold !== 'object' || !Array.isArray(gold.labels)) throw new Error('gold manifest 缺少 labels 数组')
  if (gold.labels.length !== 50) throw new Error(`gold manifest 应包含 50 条标签，实际为 ${gold.labels.length}`)

  const ids = new Set()
  const identities = new Set()
  for (const [index, label] of gold.labels.entries()) {
    const id = asString(label?.id)
    const ruleCode = asString(label?.rule_code)
    const page = asInteger(label?.page)
    const text = typeof label?.exact_clause_text === 'string' ? label.exact_clause_text : null
    const start = asInteger(label?.source_span_utf16?.start)
    const end = asInteger(label?.source_span_utf16?.end)
    const expectedMarker = page ? `PAGE-${String(page).padStart(2, '0')}-ANCHOR-${String(page).padStart(2, '0')}` : null
    if (!id || !ruleCode || !page || !text || start === null || end === null || end <= start) {
      throw new Error(`gold manifest 第 ${index + 1} 条标签字段无效`)
    }
    if (label.page_marker !== expectedMarker) throw new Error(`gold 标签 ${id} 的 page_marker 与页码不一致`)
    if (end - start !== text.length) throw new Error(`gold 标签 ${id} 的 span 长度与 exact_clause_text 不一致`)
    const identity = `${page}|${ruleCode}`
    if (ids.has(id)) throw new Error(`gold manifest 存在重复 id: ${id}`)
    if (identities.has(identity)) throw new Error(`gold manifest 存在重复 page+rule_code: ${identity}`)
    ids.add(id)
    identities.add(identity)
  }
  return gold
}

function inferPageFromExactSpan(prediction, labels) {
  if (prediction.page !== null || prediction.start === null || prediction.end === null || !prediction.rule_code) return prediction
  const matches = labels.filter((label) => (
    label.rule_code === prediction.rule_code
    && label.source_span_utf16.start === prediction.start
    && label.source_span_utf16.end === prediction.end
  ))
  if (matches.length !== 1) return { ...prediction, page_source: 'missing' }
  return { ...prediction, page: matches[0].page, page_source: 'exact_span' }
}

export function scorePredictions(goldInput, predictionPayload) {
  const gold = validateGold(goldInput)
  const labels = gold.labels
  const predictions = predictionArray(predictionPayload)
    .map(normalizePrediction)
    .map((prediction) => inferPageFromExactSpan(prediction, labels))

  const goldByIdentity = new Map(labels.map((label) => [`${label.page}|${label.rule_code}`, label]))
  const matchedGoldIds = new Set()
  const predictionIdentityCounts = new Map()
  const matches = []
  const falsePositives = []

  for (const prediction of predictions) {
    const identity = prediction.page !== null && prediction.rule_code
      ? `${prediction.page}|${prediction.rule_code}`
      : null
    if (identity) predictionIdentityCounts.set(identity, (predictionIdentityCounts.get(identity) || 0) + 1)
    const goldLabel = identity ? goldByIdentity.get(identity) : null
    if (goldLabel && !matchedGoldIds.has(goldLabel.id)) {
      matchedGoldIds.add(goldLabel.id)
      const quoteExact = prediction.exact_clause_text === goldLabel.exact_clause_text
      const spanExact = prediction.start === goldLabel.source_span_utf16.start
        && prediction.end === goldLabel.source_span_utf16.end
      matches.push({ prediction, gold: goldLabel, quote_exact: quoteExact, span_exact: spanExact })
    } else {
      falsePositives.push({
        prediction_index: prediction.index,
        identity,
        reason: goldLabel ? 'duplicate_detection' : 'no_gold_page_rule_match',
      })
    }
  }

  const tp = matches.length
  const fp = falsePositives.length
  const fn = labels.length - tp
  const precision = ratio(tp, tp + fp)
  const recall = ratio(tp, tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  const quoteExactCount = matches.filter((match) => match.quote_exact).length
  const spanExactCount = matches.filter((match) => match.span_exact).length
  const anchorExactCount = matches.filter((match) => match.quote_exact && match.span_exact).length
  const duplicateCount = [...predictionIdentityCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
  const unboundRuleCodeCount = predictions.filter((prediction) => !prediction.rule_code).length
  const unboundSnapshotCount = predictions.filter((prediction) => !prediction.rule_snapshot_id).length
  const unboundCount = predictions.filter((prediction) => !prediction.rule_code || !prediction.rule_snapshot_id).length
  const unlocatedCount = predictions.filter((prediction) => prediction.page === null).length

  const ruleCodes = [...new Set(labels.map((label) => label.rule_code))].sort()
  const perRule = Object.fromEntries(ruleCodes.map((ruleCode) => {
    const goldCount = labels.filter((label) => label.rule_code === ruleCode).length
    const matchedCount = matches.filter((match) => match.gold.rule_code === ruleCode).length
    return [ruleCode, {
      gold: goldCount,
      matched: matchedCount,
      recall: rounded(ratio(matchedCount, goldCount)),
    }]
  }))
  const macroRecall = ratio(
    Object.values(perRule).reduce((sum, value) => sum + value.recall, 0),
    ruleCodes.length,
  )

  return {
    schema_version: 'g5-accuracy-score.v1',
    benchmark_id: gold.benchmark_id,
    counts: {
      gold: labels.length,
      predictions: predictions.length,
      true_positive: tp,
      false_positive: fp,
      false_negative: fn,
    },
    metrics: {
      precision: rounded(precision),
      recall: rounded(recall),
      f1: rounded(f1),
      macro_recall: rounded(macroRecall),
      anchor_exactness: rounded(ratio(anchorExactCount, tp)),
      quote_exactness: rounded(ratio(quoteExactCount, tp)),
      span_exactness: rounded(ratio(spanExactCount, tp)),
    },
    diagnostics: {
      anchor_exact_count: anchorExactCount,
      duplicate_count: duplicateCount,
      unbound_count: unboundCount,
      unbound_rule_code_count: unboundRuleCodeCount,
      unbound_rule_snapshot_id_count: unboundSnapshotCount,
      unlocated_count: unlocatedCount,
      inferred_page_from_exact_span_count: predictions.filter((prediction) => prediction.page_source === 'exact_span').length,
      false_positives: falsePositives,
      unmatched_gold_ids: labels.filter((label) => !matchedGoldIds.has(label.id)).map((label) => label.id),
    },
    per_rule: perRule,
    definitions: {
      detection_match: 'one-to-one exact page + rule_code; a missing page may be inferred only from an exact rule_code + UTF-16 span match',
      anchor_exactness: 'among true-positive detections, exact_clause_text and the UTF-16 half-open [start,end) span must both equal gold',
      duplicate_count: 'additional predictions sharing the same explicit or inferred page + rule_code identity',
      unbound_count: 'prediction missing rule_code or immutable rule_snapshot_id; detection scoring remains separate from this release gate',
    },
  }
}

async function loadJson(location) {
  return JSON.parse(await readFile(location, 'utf8'))
}

function usage() {
  return [
    'Usage: node score-g5-accuracy.mjs <predictions.json> [gold-manifest.json]',
    '',
    'Accepted prediction roots: array, predictions, risks, result.risks, data.risks, data.riskCards.',
    'Required for a bound exact result: page (or exact source span), rule_code, rule_snapshot_id,',
    'source_quote/exact_clause_text, and UTF-16 source_start/source_end.',
  ].join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage())
    return
  }
  if (args.length < 1 || args.length > 2) throw new Error(usage())
  const predictionPath = path.resolve(args[0])
  const goldLocation = args[1] ? path.resolve(args[1]) : DEFAULT_GOLD
  const score = scorePredictions(await loadJson(goldLocation), await loadJson(predictionPath))
  console.log(JSON.stringify(score, null, 2))
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (entry === import.meta.url) {
  main().catch((error) => {
    console.error(`G5 accuracy scorer: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
  })
}
