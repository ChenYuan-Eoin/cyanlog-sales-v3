// WP44 acceptance inspects two selectors. The operator retains exclusive control of saving roles.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const CONTRACT = 'f003-prelogin-role-v1'
const ORIGIN = 'https://sales.cyanlog.icu'
const ITEMS = Object.freeze(['prelogin_role_eligibility'])
const ACTIONS = Object.freeze(['open_organization_member', 'inspect_prelogin_role_dialog', 'dismiss_without_saving',
  'inspect_role_member_picker', 'dismiss_without_adding'])
const CANDIDATE = '67a3ff4151bb415af32a878246b655b68ede4478'
const PRODUCT_TREE = '14ce3edb5fbd22b8231c24ef97b3c73b862e3286'
const ROLLBACK = '68206f866ce5f01b86da1ffe43abb881635d5c54'
const PROJECT = 'wfawwhphfqqwfwrrkogy'
const MIGRATION = 'product-truth/product-code/supabase/migrations/20261118095000_fxiaoke_prelogin_role_assignment.sql'
const MIGRATION_SHA256 = 'd4a86c3a9defd7322c00119d61ab2679208048dc68d5975c9cd9d88309fea448'
const MIGRATION_NAME = 'fxiaoke_prelogin_role_assignment'
const ALLOWED_FILES = new Set(['governance/runtime-state/active-task.json', 'governance/runtime-state/demand-inbox.jsonl',
  ...['project-registry.js', 'prelogin-role-verifier.js', 'prelogin-role-verifier.test.js'].map(name =>
    'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/' + name)])
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const validRef = item => typeof item?.path === 'string' && item.path.trim() && /^[a-f0-9]{64}$/.test(item.sha256)
const hasRefs = list => Array.isArray(list) && list.length > 0 && list.every(validRef)

function productionFirstExceptionBlockers({approval, activeId, contractVersion, productTree, candidateIsAncestor,
  changedPaths, migrationApproval, migrationReceipt, migrationSha256} = {}) {
  const errors = []
  if (activeId !== 'WP44' || contractVersion !== CONTRACT || approval?.target !== 'WP44'
    || approval?.type !== 'final_production_release_authorization' || approval.state !== 'approved' || approval.source !== 'user_explicit'
    || approval.preview_order_exception !== true || approval.preview_status !== 'not_passed' || approval.code_release_authorized !== true
    || approval.database_write_authorized !== false || approval.production_database_write_authorized !== false || approval.carrier_calls_authorized !== false)
    errors.push('WP44 requires explicit authority for this production website and read-only acceptance')
  if (candidateIsAncestor !== true || approval?.approved_candidate !== CANDIDATE || approval?.rollback_commit !== ROLLBACK
    || approval?.approved_product_tree !== PRODUCT_TREE || productTree !== PRODUCT_TREE
    || !Array.isArray(changedPaths) || changedPaths.some(file => !ALLOWED_FILES.has(file)))
    errors.push('The approved candidate, product tree, ancestry, rollback and delivery-only diff must match')
  if (migrationApproval?.type !== 'single_production_migration_authorization' || migrationApproval.target !== 'WP44'
    || migrationApproval.state !== 'approved' || migrationApproval.source !== 'user_explicit'
    || migrationApproval.id !== 'IN-20261118-047' || approval?.migration_authority_id !== migrationApproval.id
    || migrationApproval.approved_candidate !== CANDIDATE || migrationApproval.project_id !== PROJECT
    || migrationApproval.business_mutations_authorized !== false || migrationApproval.path !== MIGRATION
    || migrationApproval.sha256 !== MIGRATION_SHA256 || migrationSha256 !== MIGRATION_SHA256)
    errors.push('A separate explicit authorization must bind the exact applied migration and project')
  const history = migrationReceipt?.after?.migration
  const table = migrationReceipt?.after?.table_controls
  const target = migrationReceipt?.after?.target
  if (migrationReceipt?.tool !== 'supabase.apply_migration' || migrationReceipt.receipt?.success !== true
    || migrationReceipt.project !== PROJECT || migrationReceipt.candidate !== CANDIDATE || migrationReceipt.migration_sha256 !== MIGRATION_SHA256
    || migrationReceipt.checked_function_definitions_against_git_blob !== true || !Array.isArray(history) || history.length !== 1
    || history[0]?.name !== MIGRATION_NAME || !/^\d{14}$/.test(history[0]?.version || '')
    || table?.rls !== true || table.service_select !== true || table.anon_select !== false || table.auth_select !== false
    || table.anon_insert !== false || table.auth_insert !== false || table.service_insert !== false || table.service_update !== false || table.service_delete !== false
    || !Array.isArray(target) || target.length !== 1 || target[0]?.eligible !== true || target[0].pending !== 0
    || target[0].effective !== 0 || target[0].has_login !== false || target[0].enabled !== false)
    errors.push('The independent applied-migration receipt with read-only target and RLS evidence is required')
  return errors
}

function productionOperatorBlockers(payload, expected = {}) {
  const errors = []
  let url
  try { url = new URL(payload?.url) } catch { /* The URL check reports invalid inputs. */ }
  if (url?.origin !== ORIGIN || url.pathname !== '/configs' || url.username || url.password
    || payload?.contract_version !== CONTRACT || payload.environment !== 'production' || payload.result !== 'pass'
    || !/^[a-f0-9]{40}$/.test(expected.commit || '') || payload.commit !== expected.commit
    || !/^dpl_[a-zA-Z0-9]+$/.test(expected.deploymentId || '') || payload.deployment_id !== expected.deploymentId)
    errors.push('The production /configs observation must identify this deployment and product version')
  if (payload?.attestation_type !== 'trusted_operator_browser' || payload.trust_boundary !== 'operator_attestation_not_machine_proof'
    || payload.attestation_method !== 'codex_chrome_control_existing_session' || !String(payload.attested_by || '').trim()
    || payload.browser_context !== 'existing_user_chrome' || !String(payload.existing_tab_id || '').trim()
    || payload.new_tabs !== 0 || payload.new_browser_contexts !== 0)
    errors.push('An attestation from the existing Chrome tab is required')
  const observed = Date.parse(payload?.attested_at || '')
  const age = (expected.now ?? Date.now()) - observed
  if (!Number.isFinite(age) || age < -60_000 || age > 3_600_000) errors.push('The operator observation must be fresh')
  if (JSON.stringify(payload?.actions) !== JSON.stringify(ACTIONS) || payload?.target_name !== '刘楠楠'
    || payload.target_match_count !== 1 || payload.role_name !== '顺丰寄件操作员'
    || payload.organization_member_selectable !== true || payload.role_picker_selectable !== true)
    errors.push('Both role selectors must show the unique approved employee in the observed read-only journey')
  if (payload?.no_business_writes !== true || payload.role_saved !== false || payload.first_login_performed !== false)
    errors.push('Production acceptance must leave the real role and first login untouched')
  if (!hasRefs(payload?.attachments)) errors.push('The operator must attach a hashed observation')
  return errors
}

function denied(probe) {
  return probe?.method === 'GET' && probe.path === '/api/admin/org' && probe.credentials === 'omit'
    && probe.status === 401 && probe.error === 'Unauthorized' && /^application\/json(?:\s*;|$)/i.test(probe.content_type || '')
}

function productionBlockers(section, expected = {}) {
  const page = section?.prelogin_role_eligibility?.payload
  const verifier = section?.verifier?.payload
  if (!page || !verifier) return ['Controlled prelogin role and verifier evidence missing']
  const errors = []
  for (const item of [page, verifier]) {
    if (item.contract_version !== CONTRACT || item.environment !== 'production' || item.origin !== ORIGIN
      || item.commit !== expected.commit || item.deployment_id !== expected.deploymentId
      || !hasRefs(item.attachments) || !item.attachments.every(ref => ref.path.startsWith('production-runtime-verifier/')))
      errors.push('Invalid production version or controlled attachments for the role observation')
    if (!/^[a-f0-9]{64}$/.test(item.source_operator_sha256 || '')
      || !item.attachments?.some(ref => ref.sha256 === item.source_operator_sha256))
      errors.push('The controlled receipt must include the original operator artifact')
  }
  if (page.source !== 'trusted_existing_chrome_operator' || verifier.source !== 'live_prelogin_role_verifier'
    || page.source_operator_sha256 !== verifier.source_operator_sha256 || verifier.read_only !== true || verifier.result !== 'pass')
    errors.push('The anonymous verifier and existing-Chrome observation must bind to the same operator')
  const original = page.operator_attestation
  errors.push(...productionOperatorBlockers(original, {...expected, now: Date.parse(verifier.observed_at || '')}))
  if (Array.isArray(original?.attachments) && !original.attachments.every(ref => page.attachments?.some(copy => copy.sha256 === ref.sha256)))
    errors.push('The observed browser attachments were not carried into the controlled receipt')
  const probe = verifier.probes?.[0]
  if (!Array.isArray(verifier.probes) || verifier.probes.length !== 1 || !denied(probe) || !validRef(probe?.response_artifact)
    || !verifier.attachments?.some(ref => ref.path === probe.response_artifact.path && ref.sha256 === probe.response_artifact.sha256))
    errors.push('An application JSON 401 for the anonymous organization read must bind to a response artifact')
  return errors
}

function readArtifact(runtime, file, expectedHash) {
  const root = fs.realpathSync(runtime)
  if (!validRef({path:file, sha256:expectedHash})) throw Error('Missing runtime artifact path or hash')
  const real = fs.realpathSync(path.resolve(root, file))
  if (!real.startsWith(root + path.sep)) throw Error('Role evidence path escapes runtime')
  const stat = fs.statSync(real)
  if (!stat.isFile() || stat.size < 1 || stat.size > 25 * 1024 * 1024) throw Error('Invalid role evidence attachment size')
  const bytes = fs.readFileSync(real)
  if (digest(bytes) !== expectedHash) throw Error('Role evidence attachment SHA mismatch')
  return bytes
}

async function verify({runtime, operator, commit, deploymentId, request = fetch}) {
  const expected = {commit, deploymentId}
  const errors = productionOperatorBlockers(operator?.payload, expected)
  if (errors.length) throw Error(errors.join('; '))
  const original = readArtifact(runtime, operator.artifact_path, operator.sha256)
  if (JSON.stringify(JSON.parse(original)) !== JSON.stringify(operator.payload)) throw Error('Operator envelope differs from its original bytes')
  const response = await request(ORIGIN + '/api/admin/org', {method:'GET', credentials:'omit', redirect:'manual',
    headers:{accept:'application/json'}, signal:AbortSignal.timeout(15_000)})
  const raw = await response.text()
  if (raw.length > 128 * 1024) throw Error('Unexpected anonymous response size')
  const probe = {method:'GET', path:'/api/admin/org', credentials:'omit', status:response.status,
    content_type:response.headers.get('content-type'), error:JSON.parse(raw)?.error}
  if (!denied(probe)) throw Error('The anonymous request did not receive the application JSON 401')

  const root = fs.realpathSync(runtime)
  const destination = path.join(root, 'production-runtime-verifier')
  fs.mkdirSync(destination, {recursive:true})
  if (fs.realpathSync(destination) !== destination) throw Error('Unexpected controlled evidence directory')
  const folder = fs.mkdtempSync(path.join(destination, 'prelogin-role-'))
  const write = (name, value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))
    const target = path.join(folder, name)
    fs.writeFileSync(target, bytes)
    return {path:path.relative(root, target), sha256:digest(bytes)}
  }
  const envelope = (name, payload) => {
    const artifact = write(name, payload)
    return {artifact_path:artifact.path, sha256:artifact.sha256, payload}
  }
  const attachments = operator.payload.attachments.map((ref, i) => write('observation-' + i + path.extname(ref.path),
    readArtifact(runtime, ref.path, ref.sha256)))
  attachments.push(write('operator-original.json', original))
  probe.response_artifact = write('anonymous-response.json', {status:response.status, content_type:probe.content_type, body:{error:probe.error}, response_sha256:digest(raw)})
  const common = {contract_version:CONTRACT, environment:'production', origin:ORIGIN, commit, deployment_id:deploymentId,
    source_operator_sha256:operator.sha256, attachments}
  const section = {prelogin_role_eligibility:envelope('operator.json', {...common, source:'trusted_existing_chrome_operator',
    operator_attestation:operator.payload}), verifier:envelope('verifier.json', {...common, source:'live_prelogin_role_verifier',
    result:'pass', read_only:true, observed_at:new Date().toISOString(), probes:[probe], attachments:[...attachments,probe.response_artifact]})}
  const blockers = productionBlockers(section, expected)
  if (blockers.length) throw Error(blockers.join('; '))
  return section
}

module.exports = {CONTRACT, ITEMS, ACTIONS, productionFirstExceptionBlockers, productionOperatorBlockers, productionBlockers, verify}
