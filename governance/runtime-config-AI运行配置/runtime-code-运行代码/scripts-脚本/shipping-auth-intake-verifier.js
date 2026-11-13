// Scoped read-only Production proof for authenticated sales intake.
// Browser facts are existing-Chrome operator attestations; machine probes only
// check the anonymous boundary. Neither path submits a shipment.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const CONTRACT = 'f054-auth-intake-v1'
const ITEMS = Object.freeze(['sales_intake', 'shipping_access'])
const ACTIONS = Object.freeze(['employee_single_intake', 'employee_multi_intake', 'owner_records', 'operator_workbench'])
const ORIGIN = 'https://sales.cyanlog.icu'
const PREFIX = 'production-runtime-verifier'
const PROBES = Object.freeze([
  { path: '/sales-portal', kind: 'login_redirect' },
  { path: '/shipping', kind: 'login_redirect' },
  { path: '/api/shipping/public/options', kind: 'retired_json' },
  { path: '/api/shipping/public/orders', kind: 'retired_json' },
  { path: '/api/shipping/owner/orders', kind: 'unauthorized_json' },
])
const SHA = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const RELEASE_RULE_PATHS = new Set([
  'governance/runtime-state/active-task.json',
  'governance/runtime-state/demand-inbox.jsonl',
  'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/project-registry.js',
  'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/shipping-auth-intake-verifier.js',
  'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/shipping-auth-intake-verifier.test.js',
])
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const check = (truth, message) => { if (!truth) throw Error(message) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function productionFirstExceptionBlockers({ approval, activeId, featureId, runtimeProfile, contractVersion, productTree, changedPaths, candidateIsAncestor } = {}) {
  const errors = []
  if (activeId !== 'WP35' || featureId !== 'F054' || runtimeProfile !== 'shipping_workspace' || contractVersion !== CONTRACT) errors.push('Authenticated intake exception is limited to WP35 F054')
  if (approval?.type !== 'final_production_release_authorization' || approval?.source !== 'user_explicit' || approval?.state !== 'approved'
    || approval?.preview_order_exception !== true || approval?.preview_status !== 'not_passed'
    || approval?.code_release_authorized !== true || approval?.production_database_write_authorized !== false
    || approval?.database_write_authorized !== false || approval?.carrier_calls_authorized !== false) errors.push('Explicit read-only Production-first approval is missing')
  if (!COMMIT.test(approval?.approved_candidate || '') || candidateIsAncestor !== true
    || !COMMIT.test(approval?.approved_product_tree || '') || productTree !== approval.approved_product_tree) errors.push('Approved product tree or candidate ancestry changed')
  if (!Array.isArray(changedPaths) || changedPaths.some(file => !RELEASE_RULE_PATHS.has(file))) errors.push('Only scoped delivery rules may follow the approved product candidate')
  if (!COMMIT.test(approval?.rollback_commit || '')) errors.push('Exact rollback commit is missing')
  return errors
}

function artifact(runtime, reference) {
  const name = String(reference?.path || reference?.artifact_path || '')
  check(name && !path.isAbsolute(name) && !name.split(/[\\/]/).includes('..'), 'Unsafe evidence path')
  const bytes = fs.readFileSync(path.join(runtime, name))
  check(SHA.test(reference?.sha256 || '') && hash(bytes) === reference.sha256, 'Evidence hash mismatch')
  return bytes
}
function write(runtime, name, bytes) {
  const directory = path.join(runtime, PREFIX)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(JSON.stringify(bytes))
  const location = path.join(directory, name)
  fs.writeFileSync(location, value, { mode: 0o600 })
  return { path: `${PREFIX}/${name}`, sha256: hash(value) }
}
function envelope(runtime, name, payload) {
  const reference = write(runtime, name + '.json', payload)
  return { artifact_path: reference.path, sha256: reference.sha256, payload }
}
function operatorPayload(value, expected, { requireFresh = true } = {}) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'Operator attestation is missing')
  check(value.contract_version === CONTRACT && value.source === 'trusted_existing_chrome_operator'
    && value.environment === 'production' && value.origin === ORIGIN, 'Operator source or scope mismatch')
  check(value.commit === expected.commit && value.deployment_id === expected.deploymentId, 'Operator commit or deployment mismatch')
  check(value.url === `${ORIGIN}/shipping` || value.url === `${ORIGIN}/sales-portal`, 'Operator must replay the Production intake path')
  check(value.browser_context === 'existing_user_chrome' && value.existing_tab_id && value.new_tabs === 0 && value.new_browser_contexts === 0, 'Existing Chrome tab required')
  const safari = value.supplementary_browser
  check(safari?.browser_context === 'existing_user_safari' && safari?.attestation_method === 'codex_safari_native_existing_session'
    && String(safari?.existing_window_id || '').trim() && safari?.url === `${ORIGIN}/shipping`
    && safari?.new_tabs === 0 && safari?.new_browser_contexts === 0, 'Existing Safari operator window required')
  check(value.attestation_type === 'trusted_operator_browser' && value.trust_boundary === 'operator_attestation_not_machine_proof'
    && value.attestation_method === 'codex_chrome_control_existing_session' && String(value.attested_by || '').trim(), 'Browser trust boundary missing')
  const age = Date.now() - Date.parse(value.attested_at || '')
  check(Number.isFinite(age) && (!requireFresh || (age >= -60_000 && age < 2 * 3600_000)), 'Fresh operator attestation required')
  check(value.result === 'pass' && value.no_business_writes === true && value.carrier_calls === false, 'Read-only operator replay did not pass')
  check(same(value.actions, ACTIONS), 'Operator action sequence is incomplete')
  check(Array.isArray(value.observations) && value.observations.length === ACTIONS.length
    && value.observations.every((item, index) => item?.action === ACTIONS[index] && item?.result === 'pass'
      && item?.browser_context === (index === ACTIONS.length - 1 ? 'existing_user_safari' : 'existing_user_chrome')
      && item?.surface_id === (index === ACTIONS.length - 1 ? safari.existing_window_id : value.existing_tab_id)
      && typeof item?.detail === 'string' && item.detail.trim().length >= 15), 'Operator observations are incomplete')
  check(Array.isArray(value.attachments) && value.attachments.length > 0
    && value.attachments.every(item => typeof item?.path === 'string' && SHA.test(item.sha256 || '')), 'Raw operator attachment is missing')
  return value
}
function probeBlockers(probes) {
  const errors = []
  if (!Array.isArray(probes) || probes.length !== PROBES.length) return ['Anonymous boundary probes are incomplete']
  for (const [index, expected] of PROBES.entries()) {
    const item = probes[index]
    if (item?.path !== expected.path || item?.method !== 'GET' || item?.kind !== expected.kind || item?.credentials !== 'omit'
      || !SHA.test(item?.response_sha256 || '') || !SHA.test(item?.raw?.sha256 || '')
      || item.response_sha256 !== item.raw.sha256) errors.push(`Anonymous probe binding mismatch: ${expected.path}`)
    if (expected.kind === 'login_redirect') {
      if (![302, 303, 307, 308].includes(item?.status) || item?.location !== '/login') errors.push(`Anonymous page did not redirect to login: ${expected.path}`)
    } else if (expected.kind === 'retired_json') {
      const rejectedByMiddleware = item?.status === 401 && typeof item?.error === 'string'
      const rejectedByRoute = item?.status === 410 && item?.code === 'AUTHENTICATED_INTAKE_REQUIRED'
      if ((!rejectedByMiddleware && !rejectedByRoute)
        || !/^application\/json(?:\s*;|$)/i.test(item?.content_type || '')) errors.push(`Retired public API is still accessible: ${expected.path}`)
    } else if (item?.status !== 401 || !/^application\/json(?:\s*;|$)/i.test(item?.content_type || '') || typeof item?.error !== 'string') {
      errors.push(`Anonymous API did not return application JSON 401: ${expected.path}`)
    }
  }
  return errors
}
function productionEvidenceBlockers(section, expected) {
  const errors = []
  const verifier = section?.verifier?.payload
  const intake = section?.sales_intake?.payload
  const access = section?.shipping_access?.payload
  const sourceHash = intake?.source_operator_sha256
  if (!SHA.test(sourceHash || '') || sourceHash !== access?.source_operator_sha256 || sourceHash !== verifier?.source_operator_sha256) errors.push('Operator hash binding mismatch')
  for (const [name, value] of [['sales_intake', intake], ['shipping_access', access], ['verifier', verifier]]) {
    if (!value || value.contract_version !== CONTRACT || value.environment !== 'production' || value.origin !== ORIGIN
      || value.commit !== expected.commit || value.deployment_id !== expected.deploymentId || value.read_only !== true || value.result !== 'pass') errors.push(`${name} Production receipt mismatch`)
  }
  try { operatorPayload(intake?.operator_attestation, expected, { requireFresh: false }) } catch (error) { errors.push(error.message) }
  if (intake?.source !== 'trusted_existing_chrome_operator' || access?.source !== 'live_authenticated_intake_verifier'
    || verifier?.source !== 'live_authenticated_intake_verifier') errors.push('Production evidence source mismatch')
  if (!same(access?.probes, verifier?.probes)) errors.push('Anonymous probe receipts differ')
  errors.push(...probeBlockers(verifier?.probes))
  if (expected.runtime) {
    try {
      const original = JSON.parse(artifact(expected.runtime, verifier.source_operator_artifact).toString('utf8'))
      if (!same(original, intake.operator_attestation)) errors.push('Original operator evidence changed')
      for (const attachment of original.attachments) artifact(expected.runtime, attachment)
      for (const probe of verifier.probes) artifact(expected.runtime, probe.raw)
    } catch (error) { errors.push(error.message) }
  }
  return errors
}

async function verify({ runtime, operator, commit, deploymentId }) {
  check(COMMIT.test(commit || '') && /^dpl_[A-Za-z0-9]+$/.test(deploymentId || ''), 'Exact Production commit and deployment required')
  const originalBytes = artifact(runtime, { path: operator?.artifact_path, sha256: operator?.sha256 })
  const original = JSON.parse(originalBytes.toString('utf8'))
  check(same(original, operator.payload), 'Operator envelope payload changed')
  operatorPayload(original, { commit, deploymentId })
  const operatorCopy = write(runtime, 'operator.json', originalBytes)
  const probes = []
  for (const expected of PROBES) {
    const response = await fetch(ORIGIN + expected.path, { method: 'GET', redirect: 'manual', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(20_000) })
    const bytes = Buffer.from(await response.arrayBuffer())
    const raw = write(runtime, `anonymous-${probes.length}.bin`, bytes)
    const item = { method: 'GET', path: expected.path, kind: expected.kind, credentials: 'omit', status: response.status,
      response_sha256: hash(bytes), raw }
    if (expected.kind === 'login_redirect') {
      const location = response.headers.get('location')
      let redirect = ''
      try { const url = new URL(location || '', ORIGIN); if (url.origin === ORIGIN) redirect = url.pathname } catch { /* rejected below */ }
      item.location = redirect
    } else {
      item.content_type = response.headers.get('content-type') || ''
      try { const json = JSON.parse(bytes.toString('utf8')); item.error = json.error; item.code = json.code } catch { item.error = null }
    }
    if (response.body) await response.body.cancel().catch(() => {})
    probes.push(item)
  }
  const probeErrors = probeBlockers(probes)
  check(probeErrors.length === 0, probeErrors.join('; '))
  const common = { contract_version: CONTRACT, environment: 'production', origin: ORIGIN, commit, deployment_id: deploymentId, read_only: true, result: 'pass', source_operator_sha256: operator.sha256 }
  const result = {
    sales_intake: envelope(runtime, 'intake', { ...common, source: 'trusted_existing_chrome_operator', operator_attestation: original, attachments: [operatorCopy] }),
    shipping_access: envelope(runtime, 'access', { ...common, source: 'live_authenticated_intake_verifier', probes, attachments: probes.map(item => item.raw) }),
    verifier: envelope(runtime, 'verifier', { ...common, source: 'live_authenticated_intake_verifier', source_operator_artifact: operatorCopy, probes, attachments: [operatorCopy, ...probes.map(item => item.raw)] }),
  }
  const errors = productionEvidenceBlockers(result, { commit, deploymentId, runtime })
  check(errors.length === 0, errors.join('; '))
  return result
}

module.exports = { CONTRACT, ITEMS, ACTIONS, PROBES, productionFirstExceptionBlockers, operatorPayload, productionEvidenceBlockers, verify }
