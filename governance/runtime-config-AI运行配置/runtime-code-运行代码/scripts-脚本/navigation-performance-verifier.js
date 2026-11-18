// WP77 measures the authenticated first visit to each affected module in the existing Chrome tab.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const CONTRACT = 'navigation-performance-v1'
const ROUTES = ['/tenders', '/knowledge', '/schedule']
const ORIGIN = 'https://sales.cyanlog.icu'
const ITEMS = ['navigation_performance']
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const commitPattern = /^[a-f0-9]{40}$/

function productionFirstExceptionBlockers({ approval, activeId, contractVersion, productTree, candidateIsAncestor, changedPaths }) {
  const allowed = ['governance/runtime-state/active-task.json', 'governance/runtime-state/demand-inbox.jsonl',
    ...['project-registry.js', 'navigation-performance-verifier.js', 'navigation-performance-verifier.test.js'].map(name =>
      'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/' + name)]
  const errors = []
  if (activeId !== 'WP77' || contractVersion !== CONTRACT || approval?.target !== 'WP77'
    || approval?.type !== 'final_production_release_authorization' || approval?.state !== 'approved' || approval?.source !== 'user_explicit'
    || approval.preview_order_exception !== true || approval.preview_status !== 'not_passed'
    || approval.code_release_authorized !== true || approval.database_write_authorized !== false
    || approval.production_database_write_authorized !== false || approval.carrier_calls_authorized !== false)
    errors.push('Explicit WP77 Production-first read-only authority is required')
  if (!candidateIsAncestor || !commitPattern.test(approval?.approved_candidate || '') || !commitPattern.test(approval?.rollback_commit || '')
    || !commitPattern.test(productTree || '') || productTree !== approval?.approved_product_tree
    || !Array.isArray(changedPaths) || changedPaths.some(file => !allowed.includes(file)))
    errors.push('Navigation release must retain the approved product tree, ancestry and rollback')
  return errors
}

function measurementBlockers(payload, { commit, deploymentId, environment = 'production', origin = ORIGIN }, fresh = true) {
  const out = []
  const samples = payload?.observations
  if (payload?.environment !== environment || payload?.browser_context !== 'existing_user_chrome'
    || payload.commit !== commit || payload.deployment_id !== deploymentId || payload.no_business_writes !== true ||
    payload.new_tabs !== 0 || payload.new_browser_contexts !== 0 || !payload.existing_tab_id)
    out.push('Invalid navigation operator, version or environment')
  const age = Date.now() - Date.parse(payload?.attested_at || '')
  if (!Number.isFinite(age) || (fresh && (age < -60000 || age > 3600000))) out.push('Navigation measurement timestamp is invalid')
  if (!Array.isArray(samples) || samples.length !== ROUTES.length || ROUTES.some(route => !samples.some(row =>
    row.url === origin + route && row.from_user_navigation === true && row.content_ready === true &&
    typeof row.ready_marker === 'string' && row.ready_marker.trim().length > 0 &&
    Number.isFinite(row.elapsed_ms) && row.elapsed_ms > 0 && row.elapsed_ms <= 3000)))
    out.push('All three authenticated navigation operations must reach usable content within 3000 ms')
  return out
}

function productionEvidenceBlockers(section, expected) {
  const payload = section.navigation_performance?.payload
  if (!payload || payload.source !== 'live_navigation_read_verifier' || !/^[a-f0-9]{64}$/.test(payload.source_operator_sha256 || ''))
    return ['Missing controlled navigation evidence']
  const errors = measurementBlockers(payload.operator, expected, false)
  if (!Array.isArray(payload.probes) || payload.probes.length !== ROUTES.length ||
    ROUTES.some(route => !payload.probes.some(row => row.path === route && [302,303,307,308].includes(row.status) && row.location === '/login')))
    errors.push('Unauthenticated protected page boundary is missing')
  return errors
}

async function verify({runtime, operator, commit, deploymentId}) {
  const errors = measurementBlockers(operator.payload, {commit, deploymentId})
  if (errors.length) throw Error(errors.join('; '))
  const probes = await Promise.all(ROUTES.map(async route => {
    const response = await fetch(ORIGIN + route, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(8000) })
    const target = new URL(response.headers.get('location') || '/', ORIGIN)
    await response.body?.cancel()
    return {path: route, status: response.status, location: target.origin === ORIGIN ? target.pathname : null}
  }))
  const payload = {source:'live_navigation_read_verifier', commit, deployment_id:deploymentId, source_operator_sha256:operator.sha256,
    operator:operator.payload, probes, attachments:operator.payload.attachments}
  const artifact = 'production-runtime-verifier/navigation-performance.json'
  const bytes = Buffer.from(JSON.stringify(payload))
  const result = {navigation_performance:{artifact_path:artifact,sha256:sha(bytes),payload}}
  const issues = productionEvidenceBlockers(result, {commit,deploymentId})
  if (issues.length) throw Error(issues.join('; '))
  fs.mkdirSync(path.dirname(path.join(runtime, artifact)), {recursive:true})
  fs.writeFileSync(path.join(runtime, artifact), bytes)
  return result
}

module.exports = {CONTRACT, ROUTES, ITEMS, productionFirstExceptionBlockers, measurementBlockers, productionEvidenceBlockers, verify}
