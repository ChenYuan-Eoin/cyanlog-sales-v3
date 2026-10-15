#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REGISTRY_RELATIVE_PATH = 'governance/runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json';
const SCHEDULER_RELATIVE_PATH = 'governance/runtime-state/active-task.json';
const DEMAND_INBOX_RELATIVE_PATH = 'governance/runtime-state/demand-inbox.jsonl';
const HARNESS_SETTINGS_RELATIVE_PATH = 'governance/runtime-config-AI运行配置/config-配置文件/settings-claude运行配置.json';
const HARNESS_STATE_RELATIVE_PATH = 'governance/runtime-state/harness-state.json';
const WORK_PACKAGE_ID_PATTERN = /^WP\d{2}$/;
const HARNESS_GATE_ID_PATTERN = /^HG\d+$/;
const REQUIRED_HARNESS_GATE_IDS = ['HG0', 'HG1', 'HG2', 'HG3', 'HG4', 'HG5'];
const HARNESS_GATE_PHASES = {
  HG0: 'intake',
  HG1: 'research',
  HG2: 'contract_review',
  HG3: 'execute',
  HG4: 'verify',
  HG5: 'approval'
};
const DELIVERY_STATES = [
  'executing',
  'code_green',
  'clean_preview_green',
  'integration_ready',
  'main_integrated',
  'production_released'
];
const DELIVERY_RUNTIME_FILE = 'delivery-evidence.json';
const DELIVERY_ATTESTATION_REF = 'refs/notes/price-v3-delivery';
const VERCEL_PRODUCTION_CONTRACT = Object.freeze({
  teamId: 'team_xayPRcgRTNOgdPdNf7bOV017',
  projectId: 'prj_Vs1mumUYXLXrGGhzhPCNN8mfrVZF',
  projectName: 'cyanlog-sales-v3',
  rootDirectory: 'product-truth/product-code',
  domain: 'sales.cyanlog.icu',
  productionBranch: 'production'
});
const SHIPPING_RUNTIME_ITEMS = Object.freeze(['shipping_provider', 'shipping_request', 'shipping_tracking', 'shipping_access']);
const SHIPPING_REPLAY_ACTIONS = Object.freeze(['paste_address', 'select_sender', 'confirm_submission', 'query_tracking', 'reload_recent', 'verify_access']);
const SHIPPING_WORKSPACE_ITEMS = Object.freeze(['shipping_workspace', 'shipping_tracking', 'shipping_access']);
const SHIPPING_UI_ACTIONS = Object.freeze(['open_configuration_center', 'switch_configuration_sections', 'verify_environment_scoping', 'retain_unsaved_draft', 'verify_masked_configuration', 'return_to_workspace', 'select_order_with_keyboard', 'copy_waybill', 'download_template', 'query_tracking', 'reload_ledger', 'verify_organization_access']);
const SHIPPING_UI_FLAGS = Object.freeze(['page_accessible', 'configuration_center', 'six_sections_available', 'environment_scoping', 'draft_retention', 'credentials_masked', 'no_empty_counts', 'copy_feedback', 'template_download', 'keyboard_selection', 'no_business_mutations']);
const SHIPPING_WORKSPACE_ACTIONS = Object.freeze(['paste_address', 'select_sender', 'select_payment', 'query_tracking', 'reload_recent', 'verify_access']);
const SHIPPING_COLLABORATION_ACTIONS = Object.freeze([
  'open_configuration_center', 'verify_masked_configuration', 'paste_addresses',
  'correct_invalid_recipient', 'review_configured_batch', 'submit_anonymous_request',
  'confirm_pending_request', 'query_tracking', 'cancel_uncollected_order',
  'reload_ledger', 'verify_organization_access'
]);
const REQUIRED_DEFECT_REPLAY_ACTIONS = Object.freeze([
  'page_scroll',
  'open_edit_dialog',
  'modal_scroll_to_bottom',
  'modify_field',
  'request_close',
  'unsaved_confirm_visible',
  'continue_edit',
  'request_close_again',
  'discard_changes',
  'reopen_and_save',
  'shared_dialog_regression'
]);

function normalizeRelative(value) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function findRepoRoot(startDir = __dirname) {
  let current = path.resolve(startDir);

  while (true) {
    const registryPath = path.join(current, REGISTRY_RELATIVE_PATH);
    if (fs.existsSync(registryPath)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Repository root not found from ${startDir}`);
    }
    current = parent;
  }
}

function loadRegistry(repoRoot = findRepoRoot()) {
  const registryPath = path.join(repoRoot, REGISTRY_RELATIVE_PATH);
  const raw = fs.readFileSync(registryPath, 'utf8');
  const registry = JSON.parse(raw);
  return { repoRoot, registry, registryPath };
}

function getDocumentEntry(registry, documentId) {
  return (registry.documents || []).find((entry) => entry.id === documentId) || null;
}

function resolveDocumentPath(documentId, options = {}) {
  const { repoRoot, registry } = loadRegistry(options.repoRoot);
  const entry = getDocumentEntry(registry, documentId);
  if (!entry) {
    return null;
  }
  return {
    entry,
    relativePath: normalizeRelative(entry.path),
    absolutePath: path.join(repoRoot, entry.path)
  };
}

function resolveEnabledDocumentPath(documentId, options = {}) {
  const resolved = resolveDocumentPath(documentId, options);
  if (!resolved) {
    return null;
  }
  if (resolved.entry.enabled === false) {
    return null;
  }
  if (!pathExists(resolved.absolutePath)) {
    return null;
  }
  return resolved;
}

function resolveRuntimePath(pathValue, options = {}) {
  const { repoRoot } = loadRegistry(options.repoRoot);
  return path.join(repoRoot, pathValue);
}

function getHarnessRuntime(options = {}) {
  const { repoRoot, registry } = loadRegistry(options.repoRoot);
  return {
    repoRoot,
    config: registry.runtime && registry.runtime.harness ? registry.runtime.harness : {}
  };
}

function resolveHookCommand(hookId, options = {}) {
  const { repoRoot, config } = getHarnessRuntime(options);
  const hook = config.hook_commands && config.hook_commands[hookId];
  if (!hook) {
    return null;
  }
  return {
    command: hook.command,
    args: [path.join(repoRoot, hook.path)],
    path: path.join(repoRoot, hook.path),
    repoRoot
  };
}

function toRepoRelative(filePath, options = {}) {
  const { repoRoot } = loadRegistry(options.repoRoot);
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  return normalizeRelative(path.relative(repoRoot, absolute));
}

function isWithinDocument(filePath, documentId, options = {}) {
  const resolved = resolveDocumentPath(documentId, options);
  if (!resolved) {
    return false;
  }

  const target = resolved.relativePath;
  const fileRelative = toRepoRelative(filePath, options);
  return fileRelative === target || fileRelative.startsWith(`${target}/`);
}

function isEnabled(documentId, options = {}) {
  const resolved = resolveDocumentPath(documentId, options);
  if (!resolved) {
    return false;
  }
  return resolved.entry.enabled !== false;
}

function pathExists(targetPath) {
  return Boolean(targetPath) && fs.existsSync(targetPath);
}

function printStatus() {
  const { repoRoot, registryPath } = loadRegistry();
  const { config } = getHarnessRuntime({ repoRoot });
  const { statePath } = resolveHarnessRuntimePaths(repoRoot);
  const settingsPath = config.settings ? path.join(repoRoot, config.settings) : null;

  console.log('Harness registry status');
  console.log(`repoRoot=${repoRoot}`);
  console.log(`registry=${registryPath}`);
  console.log(`settings=${settingsPath || '-'}`);
  console.log(`state=${statePath}`);

  if (fs.existsSync(statePath)) {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    console.log(`mode=${state.mode || '-'}`);
    console.log(`phase=${state.phase || '-'}`);
    console.log(`activeGates=${(state.activeGates || []).join(',') || '-'}`);
  }
}

function runHook(hookId, extraArgs = []) {
  const resolved = resolveHookCommand(hookId);
  if (!resolved) {
    console.error(`Unknown hook command: ${hookId}`);
    return 1;
  }
  if (!fs.existsSync(resolved.path)) {
    console.error(`Hook command path does not exist: ${resolved.path}`);
    return 1;
  }

  const result = spawnSync(resolved.command, [...resolved.args, ...extraArgs], {
    cwd: resolved.repoRoot,
    stdio: 'inherit',
    env: process.env
  });
  return typeof result.status === 'number' ? result.status : 1;
}

function loadSchedulerState(options = {}) {
  const repoRoot = options.repoRoot || findRepoRoot();
  const schedulerPath = path.join(repoRoot, SCHEDULER_RELATIVE_PATH);
  const state = JSON.parse(fs.readFileSync(schedulerPath, 'utf8'));
  return { repoRoot, schedulerPath, state };
}

function loadDemandInbox(options = {}) {
  const repoRoot = options.repoRoot || findRepoRoot();
  const inboxPath = path.join(repoRoot, DEMAND_INBOX_RELATIVE_PATH);
  if (!fs.existsSync(inboxPath)) {
    return { repoRoot, inboxPath, records: [], parseErrors: ['demand inbox is missing'] };
  }

  const records = [];
  const parseErrors = [];
  const lines = fs.readFileSync(inboxPath, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      parseErrors.push(`demand inbox line ${index + 1} is invalid JSON: ${error.message}`);
    }
  });
  return { repoRoot, inboxPath, records, parseErrors };
}

function realPathOrResolved(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function inspectGitWorktreeIsolation(repoRoot) {
  const expectedTopLevel = realPathOrResolved(repoRoot);
  const configEntries = runGit(
    repoRoot,
    ['config', '--show-origin', '--show-scope', '--get-all', 'core.worktree'],
    { allowFailure: true }
  );
  const environmentOverride = String(process.env.GIT_WORK_TREE || '').trim();
  const resolvedTopLevelRaw = runGit(
    repoRoot,
    ['rev-parse', '--show-toplevel'],
    { allowFailure: true }
  );
  const resolvedTopLevel = resolvedTopLevelRaw ? realPathOrResolved(resolvedTopLevelRaw) : null;
  const blockers = [];

  if (configEntries) {
    blockers.push(`Git core.worktree must be unset in every config scope; found ${configEntries.replace(/\r?\n/g, ' | ')}`);
  }
  if (environmentOverride) {
    blockers.push(`GIT_WORK_TREE must be unset; found ${environmentOverride}`);
  }
  if (!resolvedTopLevel || resolvedTopLevel !== expectedTopLevel) {
    blockers.push(`Git top-level mismatch: expected ${expectedTopLevel}, resolved ${resolvedTopLevel || 'missing'}`);
  }

  return {
    ok: blockers.length === 0,
    expectedTopLevel,
    resolvedTopLevel,
    configEntries: configEntries || null,
    environmentOverride: environmentOverride || null,
    blockers
  };
}

function runtimeProfileOf(state) {
  return state.active_task?.delivery_contract?.runtime_profile || 'ai';
}
function runtimeContractVersionOf(state) {
  return state.active_task?.delivery_contract?.runtime_contract_version || null;
}
function requiredReplayActions(state) {
  if (runtimeProfileOf(state) === 'shipping_workspace' && runtimeContractVersionOf(state) === 'f054-ui-v1') return SHIPPING_UI_ACTIONS;
  if (runtimeProfileOf(state) === 'shipping_workspace' && runtimeContractVersionOf(state) === 'f054-v2') return SHIPPING_COLLABORATION_ACTIONS;
  if (runtimeProfileOf(state) === 'shipping_workspace') return SHIPPING_WORKSPACE_ACTIONS;
  return runtimeProfileOf(state) === 'shipping' ? SHIPPING_REPLAY_ACTIONS : REQUIRED_DEFECT_REPLAY_ACTIONS;
}
function shippingWorkspaceEvidenceBlockers(section, environment, expectedContractVersion = null) {
  const errors = [], workspace = section.shipping_workspace?.payload || {}, tracking = section.shipping_tracking?.payload || {}, access = section.shipping_access?.payload || {};
  if (expectedContractVersion && workspace.contract_version !== expectedContractVersion) errors.push('Shipping workspace evidence contract version does not match the Active contract');
  if (workspace.contract_version === 'f054-ui-v1') {
    for (const key of SHIPPING_UI_FLAGS) if (workspace[key] !== true) errors.push(`Shipping UI proof missing: ${key}`);
    for (const key of ['guest_ledger_denied', 'owner_can_read', 'organization_matched']) if (access[key] !== true) errors.push(`Shipping UI access proof missing: ${key}`);
    if (workspace.cancel_before_collection_verified !== undefined) errors.push('UI evidence must not claim cancellation verification');
    if (environment === 'production') {
      if (tracking.success !== true || tracking.mock !== false || !/^(?:SF)?[0-9]{10,15}$/.test(String(tracking.waybill || '')) || !(tracking.event_count > 0)) errors.push('Existing shipment tracking evidence is missing');
      if (tracking.sf_environment !== environment) errors.push('Tracking evidence environment mismatch');
      if (tracking.source !== 'production_database' || tracking.operator_observations_are_attested !== true) errors.push('Production UI tracking needs persisted evidence and operator attestation');
    } else if (tracking.presentation_checked !== true || tracking.no_carrier_write !== true) errors.push('Preview tracking presentation and no-write proof are missing');
    return errors;
  }
  if (['f054-v1', 'f054-v2'].includes(workspace.contract_version)) {
    for (const key of ['page_accessible','anonymous_form_submittable','receipt_recoverable','owner_direct_available','review_queue_available']) if (workspace[key] !== true) errors.push(`Shipping collaboration workspace proof missing: ${key}`);
    for (const filter of ['sales','customer','contact','status']) if (!workspace.ledger_filters?.includes(filter)) errors.push(`Shipping ledger filter proof missing: ${filter}`);
    if (environment === 'production' && workspace.production_submission_enabled !== true) errors.push('Production submission is not enabled behind the confirmed-order policy');
    for (const key of ['public_intake_allowed','guest_ledger_denied','owner_can_read','relationship_assignment_controlled','rate_limit_enforced']) if (access[key] !== true) errors.push(`Shipping collaboration access proof missing: ${key}`);
    if (workspace.contract_version === 'f054-v2') {
      for (const key of ['configuration_in_database', 'configuration_center', 'credentials_masked', 'order_configuration_snapshot_verified', 'cancel_before_collection_verified']) {
        if (workspace[key] !== true) errors.push(`Shipping configured-workbench proof missing: ${key}`);
      }
      if (workspace.cancellation_service_code !== 'EXP_RECE_UPDATE_ORDER') errors.push('Shipping cancellation service is not EXP_RECE_UPDATE_ORDER');
      if (tracking.sf_environment !== environment) errors.push('Tracking evidence environment mismatch');
      let appEndpointValid = false;
      try {
        const origin = new URL(workspace.origin);
        appEndpointValid = origin.protocol === 'https:' && origin.username === '' && origin.password === ''
          && tracking.app_endpoint === `${origin.origin}/api/shipping/tracking`
          && (environment !== 'production' || origin.origin === `https://${VERCEL_PRODUCTION_CONTRACT.domain}`);
      } catch { /* Missing origin is not proof of an application request. */ }
      if (!appEndpointValid) errors.push('Tracking application endpoint does not match the verified workspace origin');
      if (environment === 'production') {
        if (tracking.mock !== false || tracking.source !== 'production_database') errors.push('Production tracking must use persisted non-mock production evidence');
        if (tracking.operator_observations_are_attested !== true) errors.push('Tracking browser observations must declare the operator trust boundary');
      } else if (tracking.mock !== true || tracking.events_persisted !== false || tracking.order_state_unchanged !== true) {
        errors.push('Sandbox MOCK tracking must prove no event persistence or order-state mutation');
      }
    }
  } else {
    if (workspace.page_accessible !== true || workspace.address_book_usable !== true || workspace.form_editable !== true) errors.push('Shipping workspace page, address book or form proof is missing');
    if (!['sender_cash', 'recipient', 'sender_monthly'].every(x => workspace.payment_choices?.includes(x))) errors.push('Per-shipment payment choices are not verified');
    if (environment === 'production' && workspace.production_submission_disabled !== true) errors.push('Production submission must remain disabled for this workspace-only release');
    if (!Number.isInteger(workspace.outbound_count) || workspace.outbound_count < 1) errors.push('No owner outbound records were verified');
    for (const key of ['anonymous_orders_denied', 'anonymous_contacts_denied', 'owner_can_read', 'foreign_waybill_denied']) if (access[key] !== true) errors.push(`Shipping workspace access proof missing: ${key}`);
  }
  if (tracking.success !== true || !/^(?:SF)?[0-9]{10,15}$/.test(String(tracking.waybill || '')) || !Number.isInteger(tracking.event_count) || tracking.event_count < 1) errors.push('Live outbound tracking proof is missing');
  const endpoint = environment === 'production' ? 'https://sfapi.sf-express.com/std/service' : 'https://sfapi-sbox.sf-express.com/std/service';
  if (workspace.contract_version !== 'f054-v2' && tracking.endpoint !== endpoint) errors.push('Tracking endpoint does not match the required environment');
  return errors;
}

function shippingProductionVerifierScopeBlockers(status) {
  const blockers = [];
  if (status.runtimeProfile !== 'shipping_workspace' || !['f054-v2', 'f054-ui-v1'].includes(status.runtimeContractVersion)
    || status.featureId !== 'F054' || !WORK_PACKAGE_ID_PATTERN.test(String(status.activeId || ''))) {
    blockers.push('Verifier requires the scoped F054 configured-workbench contract');
  }
  if (status.targetState !== 'production_released' || (status.runtimeContractVersion === 'f054-ui-v1'
    ? status.productionReleaseAuthorization?.status !== 'approved_code_only' || status.productionDatabaseMode !== 'read_only'
    : status.productionReleaseAuthorization?.status !== 'approved_for_final_release' || status.productionDatabaseMode !== 'controlled_write_approved')) {
    blockers.push('Verifier requires the approved Production release and write contract');
  }
  return blockers;
}
function shippingRuntimeEvidenceBlockers(section, environment) {
  const blockers = [];
  const provider = section.shipping_provider?.payload || {};
  const request = section.shipping_request?.payload || {};
  const tracking = section.shipping_tracking?.payload || {};
  const access = section.shipping_access?.payload || {};
  const expectedEndpoint = environment === 'production'
    ? 'https://sfapi.sf-express.com/std/service'
    : 'https://sfapi-sbox.sf-express.com/std/service';
  if (provider.provider !== 'sf-express' || provider.success !== true || provider.endpoint !== expectedEndpoint || provider.sf_environment !== environment) blockers.push('Shipping provider proof is not a successful call to the required SF environment');
  if (!/^PV3[a-f0-9]{28}$/.test(String(request.request_id || '')) || request.status !== 'accepted' || !/^(?:SF)?[0-9]{10,15}$/.test(String(request.waybill || ''))) blockers.push('Shipping request proof has no accepted request and waybill');
  if (!/^[0-9a-f-]{36}$/i.test(String(request.created_by || ''))) blockers.push('Shipping request proof has no authenticated owner');
  if (provider.order_id !== request.request_id) blockers.push('Shipping provider proof is not bound to the same request');
  if (tracking.success !== true || tracking.waybill !== request.waybill || !Number.isInteger(tracking.event_count) || tracking.event_count < 0) blockers.push('Shipping tracking proof is missing or refers to a different waybill');
  for (const check of ['anonymous_orders_denied', 'anonymous_contacts_denied', 'owner_can_read', 'public_page_accessible', 'same_key_single_request']) {
    if (access[check] !== true) blockers.push(`Shipping access or idempotency proof missing: ${check}`);
  }
  return blockers;
}

function validateSchedulerState(options = {}) {
  const { repoRoot, state } = loadSchedulerState(options);
  const { records: inboxRecords, parseErrors: inboxParseErrors } = loadDemandInbox(options);
  const errors = [];
  const worktreeIsolation = inspectGitWorktreeIsolation(repoRoot);
  const activeId = state.active_task && state.active_task.id;
  const queuedActiveId = state.execution_queue && state.execution_queue.active && state.execution_queue.active.id;
  const allowedPaths = state.active_task && state.active_task.allowed_paths;
  const deliveryContract = state.active_task && state.active_task.delivery_contract;

  errors.push(...worktreeIsolation.blockers);

  if (!activeId) errors.push('active_task.id is required');
  if (!queuedActiveId) errors.push('execution_queue.active.id is required');
  if (activeId && queuedActiveId && activeId !== queuedActiveId) {
    errors.push(`active mismatch: active_task=${activeId}, execution_queue=${queuedActiveId}`);
  }
  if (activeId && !WORK_PACKAGE_ID_PATTERN.test(activeId)) {
    errors.push(`active_task.id must be a short work-package id (WP00-WP99): ${activeId}`);
  }
  const nextId = state.execution_queue && state.execution_queue.next && state.execution_queue.next.id;
  if (nextId && !WORK_PACKAGE_ID_PATTERN.test(nextId)) {
    errors.push(`execution_queue.next.id must be a short work-package id (WP00-WP99): ${nextId}`);
  }
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    errors.push('active_task.allowed_paths must contain at least one path');
  }
  if (!deliveryContract || !DELIVERY_STATES.includes(deliveryContract.target_state)) {
    errors.push(`active_task.delivery_contract.target_state must be one of ${DELIVERY_STATES.join(', ')}`);
  }
  if (
    deliveryContract
    && (
      !Array.isArray(deliveryContract.allowed_states)
      || deliveryContract.allowed_states.length !== DELIVERY_STATES.indexOf(deliveryContract.target_state) + 1
      || deliveryContract.allowed_states.some((item, index) => item !== DELIVERY_STATES[index])
    )
  ) {
    errors.push('active_task.delivery_contract.allowed_states must be the canonical prefix through target_state');
  }
  if (deliveryContract && deliveryContract.integration_branch !== 'main') {
    errors.push('active_task.delivery_contract.integration_branch must be main');
  }
  if (deliveryContract && deliveryContract.production_release_separate !== true) {
    errors.push('active_task.delivery_contract.production_release_separate must be true');
  }
  if (deliveryContract && deliveryContract.same_release_commit_required !== true) {
    errors.push('active_task.delivery_contract.same_release_commit_required must be true');
  }
  if (deliveryContract && deliveryContract.attestation_ref !== DELIVERY_ATTESTATION_REF) {
    errors.push(`active_task.delivery_contract.attestation_ref must be ${DELIVERY_ATTESTATION_REF}`);
  }
  const requiredCodeChecks = deliveryContract?.required_code_checks;
  const canonicalCodeChecks = ['target_tests', 'full_tests', 'lint', 'typecheck', 'build'];
  if (
    deliveryContract
    && (
      !Array.isArray(requiredCodeChecks)
      || canonicalCodeChecks.some((check) => !requiredCodeChecks.includes(check))
      || new Set(requiredCodeChecks).size !== requiredCodeChecks.length
    )
  ) {
    errors.push(`active_task.delivery_contract.required_code_checks must include ${canonicalCodeChecks.join(', ')}`);
  }
  const requiredRuntimeEvidence = deliveryContract?.required_runtime_evidence;
  const profile = runtimeProfileOf(state);
  if (!['ai', 'shipping', 'shipping_workspace'].includes(profile)) errors.push('Unknown runtime evidence profile');
  if (['shipping', 'shipping_workspace'].includes(profile) && state.active_task?.feature_id !== 'F054') errors.push('Shipping evidence profile requires the F054 feature binding');
  const contractVersion = runtimeContractVersionOf(state);
  if (contractVersion && (profile !== 'shipping_workspace' || !['f054-v1', 'f054-v2', 'f054-ui-v1'].includes(contractVersion))) errors.push('Unknown or mismatched shipping workspace contract version');
  const canonicalRuntimeEvidence = profile === 'shipping_workspace' ? SHIPPING_WORKSPACE_ITEMS : profile === 'shipping' ? SHIPPING_RUNTIME_ITEMS : ['provider_probe', 'review_run', 'model_invocations', 'tokens'];
  if (
    deliveryContract
    && (
      !Array.isArray(requiredRuntimeEvidence)
      || canonicalRuntimeEvidence.some((item) => !requiredRuntimeEvidence.includes(item))
      || new Set(requiredRuntimeEvidence).size !== requiredRuntimeEvidence.length
    )
  ) {
    errors.push(`active_task.delivery_contract.required_runtime_evidence must include ${canonicalRuntimeEvidence.join(', ')}`);
  }
  if (deliveryContract?.target_state === 'production_released') {
    const requiredProductionRuntimeEvidence = deliveryContract.required_production_runtime_evidence;
    if (
      !Array.isArray(requiredProductionRuntimeEvidence)
      || canonicalRuntimeEvidence.some((item) => !requiredProductionRuntimeEvidence.includes(item))
      || new Set(requiredProductionRuntimeEvidence).size !== requiredProductionRuntimeEvidence.length
    ) {
      errors.push(`active_task.delivery_contract.required_production_runtime_evidence must include ${canonicalRuntimeEvidence.join(', ')}`);
    }
    const releaseAuthorization = deliveryContract.production_release_authorization;
    for (const field of ['status', 'micro_fix_approval_id', 'clarification_id', 'micro_fix_scope', 'final_scope']) {
      if (!String(releaseAuthorization?.[field] || '').trim()) {
        errors.push(`active_task.delivery_contract.production_release_authorization.${field} is required`);
      }
    }
    if (!['pending_security_gate_and_final_write_approval', 'approved_for_final_release', 'approved_code_only'].includes(releaseAuthorization?.status)) {
      errors.push('active_task.delivery_contract.production_release_authorization.status is invalid');
    }
    if (['approved_for_final_release', 'approved_code_only'].includes(releaseAuthorization?.status) && !String(releaseAuthorization?.final_release_approval_id || '').trim()) {
      errors.push('active_task.delivery_contract.production_release_authorization.final_release_approval_id is required for final release');
    }
    if (deliveryContract.final_acceptance?.browser !== 'trusted_operator_attestation_from_user_existing_chrome_only') {
      errors.push('active_task.delivery_contract.final_acceptance must distinguish trusted existing-Chrome operator attestation from machine proof');
    }
    const databaseMode = deliveryContract.final_acceptance?.production_database_mode;
    if (!['read_only_pending_security_gate_and_final_approval', 'controlled_write_approved', 'read_only'].includes(databaseMode)) {
      errors.push('active_task.delivery_contract.final_acceptance.production_database_mode is invalid');
    }
    if (releaseAuthorization?.status === 'approved_for_final_release' && databaseMode !== 'controlled_write_approved') {
      errors.push('final Production release approval requires controlled_write_approved database mode');
    }
    if (releaseAuthorization?.status === 'approved_code_only' && (databaseMode !== 'read_only' || contractVersion !== 'f054-ui-v1'
      || releaseAuthorization.database_write_authorized !== false)) errors.push('Code-only release requires the UI contract and explicit read-only database boundary');
  }
  for (const dynamicKey of ['evidence', 'release_control', 'releaseControl', 'completionState', 'completion_state', 'defects']) {
    if (deliveryContract && Object.prototype.hasOwnProperty.call(deliveryContract, dynamicKey)) {
      errors.push(`active_task.delivery_contract must not contain dynamic runtime key: ${dynamicKey}`);
    }
  }

  const queueIds = [];
  if (queuedActiveId) queueIds.push(queuedActiveId);
  if (state.execution_queue && state.execution_queue.next && state.execution_queue.next.id) {
    queueIds.push(state.execution_queue.next.id);
  }
  for (const lane of ['ready', 'parked', 'completed']) {
    for (const item of (state.execution_queue && state.execution_queue[lane]) || []) {
      if (item.id) queueIds.push(item.id);
    }
  }
  const duplicates = [...new Set(queueIds.filter((id, index) => queueIds.indexOf(id) !== index))];
  if (duplicates.length) errors.push(`queue ids must be unique: ${duplicates.join(', ')}`);
  const nonCanonicalWorkPackageIds = [...new Set(queueIds.filter((id) => id.startsWith('WP') && !WORK_PACKAGE_ID_PATTERN.test(id)))];
  if (nonCanonicalWorkPackageIds.length) {
    errors.push(`work-package queue ids must not contain names or slugs: ${nonCanonicalWorkPackageIds.join(', ')}`);
  }

  errors.push(...inboxParseErrors);
  const inboxIds = inboxRecords.map((record) => record && record.id).filter(Boolean);
  const duplicateInboxIds = [...new Set(inboxIds.filter((id, index) => inboxIds.indexOf(id) !== index))];
  if (duplicateInboxIds.length) {
    errors.push(`demand inbox ids must be unique: ${duplicateInboxIds.join(', ')}`);
  }
  const missingInboxIds = inboxRecords.filter((record) => !record || !record.id).length;
  if (missingInboxIds) errors.push(`demand inbox records missing id: ${missingInboxIds}`);
  if (deliveryContract?.target_state === 'production_released') {
    const releaseAuthorization = deliveryContract.production_release_authorization || {};
    for (const field of ['micro_fix_approval_id', 'clarification_id', 'final_release_approval_id']) {
      const id = releaseAuthorization[field];
      if (id && !inboxIds.includes(id)) {
        errors.push(`Production release authorization ${field} is missing from demand inbox: ${id}`);
      }
    }
    if (['approved_for_final_release', 'approved_code_only'].includes(releaseAuthorization.status)) {
      const finalRecord = inboxRecords.find((record) => record?.id === releaseAuthorization.final_release_approval_id);
      if (finalRecord?.type !== 'final_production_release_authorization') errors.push('final Production authorization inbox record type is invalid');
      if (finalRecord?.state !== 'approved') errors.push('final Production authorization inbox record state is not approved');
      if (finalRecord?.source !== 'user_explicit') errors.push('final Production authorization inbox record is not user explicit');
      if (finalRecord?.scope !== releaseAuthorization.final_scope) errors.push('final Production authorization inbox record scope mismatch');
      if (releaseAuthorization.status === 'approved_code_only') {
        if (finalRecord?.code_release_authorized !== true || finalRecord?.production_database_write_authorized !== false) errors.push('Code-only Production authorization must explicitly preserve the database write boundary');
      } else if (finalRecord?.production_write_authorized !== true) errors.push('final Production authorization inbox record does not allow controlled writes');
      if (finalRecord?.authorized_commit_binding !== 'delivery_attestation_current_head') errors.push('final Production authorization inbox record has no exact-HEAD attestation binding');
    }
  }

  try {
    const settingsPath = path.join(repoRoot, HARNESS_SETTINGS_RELATIVE_PATH);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const gateIds = Object.keys(settings.gates || {});
    const invalidGateIds = gateIds.filter((id) => !HARNESS_GATE_ID_PATTERN.test(id));
    if (invalidGateIds.length) {
      errors.push(`Harness gate ids must use HG namespace: ${invalidGateIds.join(', ')}`);
    }
    const missingGateIds = REQUIRED_HARNESS_GATE_IDS.filter((id) => !gateIds.includes(id));
    if (missingGateIds.length) {
      errors.push(`Harness settings must retain the six canonical gates: missing ${missingGateIds.join(', ')}`);
    }
    const extraGateIds = gateIds.filter((id) => !REQUIRED_HARNESS_GATE_IDS.includes(id));
    if (extraGateIds.length) {
      errors.push(`Harness settings may only define HG0-HG5: ${extraGateIds.join(', ')}`);
    }
    const phaseMismatches = REQUIRED_HARNESS_GATE_IDS.filter(
      (id) => settings.gates?.[id]?.phase !== HARNESS_GATE_PHASES[id]
    );
    if (phaseMismatches.length) {
      errors.push(`Harness gate phase mapping is invalid: ${phaseMismatches.join(', ')}`);
    }
  } catch (error) {
    errors.push(`Harness settings are invalid: ${error.message}`);
  }

  try {
    const {
      statePath: harnessStatePath,
      contractPath: harnessContractPath
    } = resolveHarnessRuntimePaths(repoRoot);
    let harnessState = null;
    let harnessContract = null;
    if (fs.existsSync(harnessStatePath)) {
      harnessState = JSON.parse(fs.readFileSync(harnessStatePath, 'utf8'));
      const activeGates = harnessState.activeGates || [];
      const invalidActiveGates = activeGates.filter(
        (id) => !REQUIRED_HARNESS_GATE_IDS.includes(id)
      );
      if (invalidActiveGates.length) {
        errors.push(`active Harness gates must use HG namespace: ${invalidActiveGates.join(', ')}`);
      }
      if (activeGates.length > 1) {
        errors.push(`Harness state may activate at most one gate: ${activeGates.join(', ')}`);
      }
      if (state.active_task?.status === 'active') {
        if (harnessState.mode !== 'enforcing') {
          errors.push(`active work package requires enforcing Harness, got ${harnessState.mode || 'missing'}`);
        }
        if (harnessState.currentGoal?.workPackageId !== activeId) {
          errors.push(`Harness work package mismatch: expected ${activeId}, got ${harnessState.currentGoal?.workPackageId || 'missing'}`);
        }
        if (activeGates.length !== 1) {
          errors.push('active work package requires exactly one active Harness gate');
        }
      }
    } else if (state.active_task?.status === 'active') {
      errors.push('active work package requires a worktree-local Harness state');
    }
    if (state.active_task?.status === 'active') {
      if (!fs.existsSync(harnessContractPath)) {
        errors.push('active work package requires a worktree-local Harness goal contract');
      } else {
        harnessContract = JSON.parse(fs.readFileSync(harnessContractPath, 'utf8'));
        if (harnessContract.workPackageId !== activeId) {
          errors.push(`Harness contract work package mismatch: expected ${activeId}, got ${harnessContract.workPackageId || 'missing'}`);
        }
        if (!['approved', 'active'].includes(harnessContract.status)) {
          errors.push(`Harness goal contract must be approved, got ${harnessContract.status || 'missing'}`);
        }
      }
    }
    if (state.active_task?.status === 'active' && harnessState && harnessContract) {
      const activeGate = harnessState.activeGates?.[0] || null;
      const expectedPhase = activeGate ? HARNESS_GATE_PHASES[activeGate] : null;
      if (harnessState.currentGoal?.id !== harnessContract.id) {
        errors.push(`Harness goal mismatch: state ${harnessState.currentGoal?.id || 'missing'}, contract ${harnessContract.id || 'missing'}`);
      }
      if (harnessState.phase !== harnessContract.phase?.current) {
        errors.push(`Harness phase mismatch: state ${harnessState.phase || 'missing'}, contract ${harnessContract.phase?.current || 'missing'}`);
      }
      if (activeGate !== harnessContract.phase?.gate) {
        errors.push(`Harness gate mismatch: state ${activeGate || 'missing'}, contract ${harnessContract.phase?.gate || 'missing'}`);
      }
      if (expectedPhase && harnessState.phase !== expectedPhase) {
        errors.push(`Harness canonical gate/phase mismatch: ${activeGate} requires ${expectedPhase}, got ${harnessState.phase || 'missing'}`);
      }
      const activeStartedAt = Date.parse(state.active_task.started_at || '');
      const contractCreatedAt = Date.parse(harnessContract.createdAt || '');
      if (!Number.isFinite(activeStartedAt) || !Number.isFinite(contractCreatedAt)) {
        errors.push('Harness and Active start timestamps must be valid ISO dates');
      } else if (contractCreatedAt < activeStartedAt) {
        errors.push(`Harness goal predates Active work package: ${harnessContract.createdAt} < ${state.active_task.started_at}`);
      }
    }
  } catch (error) {
    errors.push(`Harness state is invalid: ${error.message}`);
  }

  const baselineStatus = state.product_baseline && state.product_baseline.status;
  if (state.active_task && state.active_task.kind === 'product' && baselineStatus !== 'active') {
    errors.push(`product task cannot be active while product baseline is ${baselineStatus || 'missing'}`);
  }

  return {
    ok: errors.length === 0,
    activeId,
    baselineStatus,
    errors
  };
}

function runGit(repoRoot, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(options.timeoutMs ? { timeout: options.timeoutMs, killSignal: 'SIGTERM' } : {})
  });
  if (options.allowFailure && result.status !== 0) {
    return null;
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
  }
  return (result.stdout || '').trim();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function sha256Canonical(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(value)), 'utf8')
    .digest('hex');
}

function deliveryContentDigest(value) {
  const payload = { ...(value || {}) };
  delete payload.attestationDigest;
  delete payload.contentDigest;
  delete payload.previousAttestationDigest;
  delete payload.previousAttestation;
  delete payload.revision;
  delete payload.sealedAt;
  delete payload.updatedAt;
  return sha256Canonical(payload);
}

function sealedAttestationDigest(value) {
  const payload = { ...(value || {}) };
  delete payload.attestationDigest;
  return sha256Canonical(payload);
}

function readRemoteSnapshot(repoRoot) {
  const checkedAt = new Date().toISOString();
  const raw = runGit(repoRoot, [
    'ls-remote',
    '--symref',
    'origin',
    'HEAD',
    'refs/heads/main',
    'refs/heads/production',
    DELIVERY_ATTESTATION_REF
  ], { allowFailure: true, timeoutMs: 15000 });
  const snapshot = {
    checkedAt,
    available: Boolean(raw),
    defaultBranch: null,
    main: null,
    production: null,
    attestation: null
  };
  if (!raw) return snapshot;

  for (const line of raw.split(/\r?\n/)) {
    const symref = line.match(/^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/);
    if (symref) {
      snapshot.defaultBranch = symref[1];
      continue;
    }
    const match = line.match(/^([0-9a-f]{40,64})\s+(.+)$/i);
    if (!match) continue;
    const [, oid, ref] = match;
    if (ref === 'refs/heads/main') snapshot.main = oid;
    if (ref === 'refs/heads/production') snapshot.production = oid;
    if (ref === DELIVERY_ATTESTATION_REF) snapshot.attestation = oid;
  }
  return snapshot;
}

function resolveHarnessRuntimePaths(repoRoot) {
  const runtimeDir = process.env.PRICE_V3_HARNESS_RUNTIME_DIR
    ? path.resolve(process.env.PRICE_V3_HARNESS_RUNTIME_DIR)
    : runGit(repoRoot, [
        'rev-parse',
        '--path-format=absolute',
        '--git-path',
        'codex-runtime/harness'
      ]);
  const runtime = {
    statePath: path.join(runtimeDir, 'harness-state.json'),
    contractPath: path.join(runtimeDir, 'goal-contract.json'),
    evidenceLedgerPath: path.join(runtimeDir, 'evidence-ledger.jsonl')
  };
  return {
    runtimeDir,
    statePath: runtime.statePath,
    contractPath: runtime.contractPath,
    evidenceLedgerPath: runtime.evidenceLedgerPath
  };
}

function deliveryStateAtLeast(actual, expected) {
  return DELIVERY_STATES.indexOf(actual) >= DELIVERY_STATES.indexOf(expected);
}

function getDeliveryRuntimePath(repoRoot) {
  const runtimeDir = runGit(repoRoot, [
    'rev-parse',
    '--path-format=absolute',
    '--git-path',
    'codex-runtime'
  ]);
  return path.join(runtimeDir, DELIVERY_RUNTIME_FILE);
}

function writePrivateRuntimeJson(repoRoot, relativePath, rawJson) {
  const runtimeRoot = path.dirname(getDeliveryRuntimePath(repoRoot));
  const targetPath = path.join(runtimeRoot, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(targetPath, rawJson, { mode: 0o600 });
  fs.chmodSync(targetPath, 0o600);
  return {
    artifact_path: normalizeRelative(path.relative(runtimeRoot, targetPath)),
    sha256: crypto.createHash('sha256').update(rawJson, 'utf8').digest('hex')
  };
}

function runVercelApi(repoRoot, endpoint) {
  const productCodeRoot = path.join(repoRoot, VERCEL_PRODUCTION_CONTRACT.rootDirectory);
  const result = spawnSync('pnpm', [
    'exec',
    'vercel',
    'api',
    endpoint,
    '--raw',
    '--non-interactive',
    '--no-color'
  ], {
    cwd: productCodeRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
    killSignal: 'SIGTERM',
    maxBuffer: 25 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' }
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.error?.message || result.stderr || result.stdout || 'unknown Vercel CLI failure')
      .trim()
      .slice(0, 500);
    throw new Error(`Vercel API GET failed for ${endpoint}: ${detail}`);
  }
  const raw = String(result.stdout || '').trim();
  if (!raw) throw new Error(`Vercel API GET returned an empty response for ${endpoint}`);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Vercel API GET returned invalid JSON for ${endpoint}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Vercel API GET returned a non-object response for ${endpoint}`);
  }
  return { raw: `${raw}\n`, parsed };
}

function isSelftestVercelInjection(repoRoot, injected) {
  if (!injected || injected.__test_only !== true) return false;
  try {
    return loadRegistry(repoRoot).registry.version === 'selftest';
  } catch {
    return false;
  }
}

function resolveVercelDeploymentCommit(deployment) {
  const candidates = [
    ['gitSource.sha', deployment?.gitSource?.sha],
    ['meta.githubCommitSha', deployment?.meta?.githubCommitSha],
    ['meta.gitCommitSha', deployment?.meta?.gitCommitSha]
  ]
    .filter(([, value]) => /^[0-9a-f]{40,64}$/i.test(String(value || '')))
    .map(([source, value]) => ({ source, value: String(value).toLowerCase() }));
  const values = [...new Set(candidates.map((candidate) => candidate.value))];
  return {
    sha: values.length === 1 ? values[0] : null,
    candidates,
    conflict: values.length > 1
  };
}

function verifyVercelProductionState(repoRoot, remoteProduction, options = {}) {
  const checkedAt = new Date().toISOString();
  const artifactPrefix = `vercel-production-verifier/${options.stage || 'gate'}/${checkedAt.replace(/[^0-9A-Za-z]/g, '-')}-${process.pid}`;
  const query = `teamId=${encodeURIComponent(VERCEL_PRODUCTION_CONTRACT.teamId)}`;
  const endpoints = {
    project: `/v9/projects/${VERCEL_PRODUCTION_CONTRACT.projectId}?${query}`,
    domain: `/v9/projects/${VERCEL_PRODUCTION_CONTRACT.projectId}/domains/${VERCEL_PRODUCTION_CONTRACT.domain}?${query}`,
    deployment: null
  };
  const blockers = [];
  let projectResponse;
  let domainResponse;
  let deploymentResponse;
  let source = 'live-vercel-api';

  try {
    const injected = options.testOnlyVercelApiResponses;
    if (injected) {
      if (!isSelftestVercelInjection(repoRoot, injected)) {
        throw new Error('test-only Vercel verifier injection is forbidden outside a selftest registry');
      }
      source = 'selftest-injected';
      projectResponse = { raw: `${JSON.stringify(injected.project)}\n`, parsed: injected.project };
      domainResponse = { raw: `${JSON.stringify(injected.domain)}\n`, parsed: injected.domain };
      deploymentResponse = { raw: `${JSON.stringify(injected.deployment)}\n`, parsed: injected.deployment };
    } else {
      projectResponse = runVercelApi(repoRoot, endpoints.project);
      domainResponse = runVercelApi(repoRoot, endpoints.domain);
      const liveDeploymentId = projectResponse.parsed?.targets?.production?.id;
      if (!/^dpl_[A-Za-z0-9]+$/.test(String(liveDeploymentId || ''))) {
        throw new Error('Vercel project has no valid targets.production deployment ID');
      }
      endpoints.deployment = `/v13/deployments/${liveDeploymentId}?${query}`;
      deploymentResponse = runVercelApi(repoRoot, endpoints.deployment);
    }
  } catch (error) {
    return {
      ok: false,
      blockers: [`live Vercel Production verification failed closed: ${error.message}`],
      snapshot: {
        version: 1,
        source,
        checkedAt,
        contract: VERCEL_PRODUCTION_CONTRACT,
        endpoints,
        raw: {}
      }
    };
  }

  const project = projectResponse.parsed;
  const domain = domainResponse.parsed;
  const deployment = deploymentResponse.parsed;
  const deploymentCommit = resolveVercelDeploymentCommit(deployment);
  const liveDeploymentId = project?.targets?.production?.id;
  endpoints.deployment = `/v13/deployments/${liveDeploymentId}?${query}`;
  const raw = {
    project: writePrivateRuntimeJson(repoRoot, `${artifactPrefix}-project.json`, projectResponse.raw),
    domain: writePrivateRuntimeJson(repoRoot, `${artifactPrefix}-domain.json`, domainResponse.raw),
    deployment: writePrivateRuntimeJson(repoRoot, `${artifactPrefix}-deployment.json`, deploymentResponse.raw)
  };
  const snapshot = {
    version: 1,
    source,
    checkedAt,
    contract: VERCEL_PRODUCTION_CONTRACT,
    endpoints,
    project: {
      id: project?.id || null,
      name: project?.name || null,
      teamId: project?.accountId || null,
      rootDirectory: project?.rootDirectory || null,
      productionBranch: project?.link?.productionBranch || null,
      productionDeploymentId: liveDeploymentId || null
    },
    domain: {
      name: domain?.name || null,
      projectId: domain?.projectId || null,
      verified: domain?.verified === true
    },
    deployment: {
      id: deployment?.id || null,
      name: deployment?.name || null,
      projectId: deployment?.project?.id || null,
      teamId: deployment?.team?.id || null,
      target: deployment?.target || null,
      readyState: deployment?.readyState || null,
      readySubstate: deployment?.readySubstate || null,
      status: deployment?.status || null,
      gitCommitSha: deploymentCommit.sha,
      gitCommitSources: deploymentCommit.candidates.map((candidate) => candidate.source)
    },
    remoteProduction: remoteProduction || null,
    raw
  };

  if (project?.id !== VERCEL_PRODUCTION_CONTRACT.projectId) blockers.push('live Vercel project ID mismatch');
  if (project?.name !== VERCEL_PRODUCTION_CONTRACT.projectName) blockers.push('live Vercel project name mismatch');
  if (project?.accountId !== VERCEL_PRODUCTION_CONTRACT.teamId) blockers.push('live Vercel project team mismatch');
  if (project?.rootDirectory !== VERCEL_PRODUCTION_CONTRACT.rootDirectory) blockers.push('live Vercel project rootDirectory mismatch');
  if (project?.link?.productionBranch !== VERCEL_PRODUCTION_CONTRACT.productionBranch) blockers.push('live Vercel productionBranch is not production');
  if (!/^dpl_[A-Za-z0-9]+$/.test(String(liveDeploymentId || ''))) blockers.push('live Vercel Production deployment ID is invalid');
  if (domain?.name !== VERCEL_PRODUCTION_CONTRACT.domain) blockers.push('live Vercel project domain name mismatch');
  if (domain?.projectId !== VERCEL_PRODUCTION_CONTRACT.projectId) blockers.push('live Vercel project domain is attached to a different project');
  if (domain?.verified !== true) blockers.push('live Vercel project domain is not verified');
  if (deployment?.id !== liveDeploymentId) blockers.push('live Vercel project/deployment IDs do not agree');
  if (deployment?.project?.id !== VERCEL_PRODUCTION_CONTRACT.projectId) blockers.push('live Vercel deployment project ID mismatch');
  if (deployment?.project?.name !== VERCEL_PRODUCTION_CONTRACT.projectName) blockers.push('live Vercel deployment project name mismatch');
  if (deployment?.team?.id !== VERCEL_PRODUCTION_CONTRACT.teamId) blockers.push('live Vercel deployment team mismatch');
  if (deployment?.name !== VERCEL_PRODUCTION_CONTRACT.projectName) blockers.push('live Vercel deployment name mismatch');
  if (deployment?.target !== 'production') blockers.push('live Vercel deployment target is not production');
  if (deployment?.readyState !== 'READY' || deployment?.status !== 'READY') blockers.push('live Vercel Production deployment is not READY');
  if (deployment?.readySubstate !== 'PROMOTED') blockers.push('live Vercel Production deployment is not PROMOTED');
  if (!Array.isArray(deployment?.alias) || !deployment.alias.includes(VERCEL_PRODUCTION_CONTRACT.domain)) blockers.push('live Vercel Production deployment does not own the product domain alias');
  if (!/^[0-9a-f]{40,64}$/i.test(String(remoteProduction || ''))) blockers.push('remote production OID is missing or invalid');
  if (!deploymentCommit.candidates.length) blockers.push('live Vercel Production source SHA is missing');
  if (deploymentCommit.conflict) blockers.push('live Vercel Production exposes conflicting source SHAs');
  if (deploymentCommit.sha !== String(remoteProduction || '').toLowerCase()) blockers.push('live Vercel Production source SHA does not equal remote production OID');

  return { ok: blockers.length === 0, blockers, snapshot };
}

function loadDeliveryRuntime(options = {}) {
  const { repoRoot, state } = loadSchedulerState(options);
  const runtimePath = getDeliveryRuntimePath(repoRoot);
  if (!fs.existsSync(runtimePath)) {
    return { runtimePath, data: {} };
  }

  try {
    const data = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    if (data.activeId !== state.active_task?.id) {
      return { runtimePath, data: {} };
    }
    const head = runGit(repoRoot, ['rev-parse', 'HEAD']);
    if (data.commit !== head) {
      return { runtimePath, data: {} };
    }
    return { runtimePath, data };
  } catch (error) {
    throw new Error(`delivery runtime evidence is invalid: ${error.message}`);
  }
}

function runtimePayloadFromNote(note) {
  const payload = { ...(note || {}) };
  for (const key of [
    'attestationDigest',
    'contentDigest',
    'previousAttestationDigest',
    'previousAttestation',
    'revision',
    'sealedAt'
  ]) {
    delete payload[key];
  }
  return payload;
}

function loadDeliveryMutableBase(options = {}) {
  const { repoRoot, state } = loadSchedulerState(options);
  const head = options.head || runGit(repoRoot, ['rev-parse', 'HEAD']);
  const runtimeResult = loadDeliveryRuntime({ repoRoot });
  const note = options.note || loadDeliveryNote(repoRoot, head, state.active_task?.id);
  const runtimeIndex = DELIVERY_STATES.indexOf(runtimeResult.data.completionState || 'executing');
  const noteIndex = DELIVERY_STATES.indexOf(note.completionState || 'executing');
  if (note.commit && (!runtimeResult.data.commit || noteIndex > runtimeIndex)) {
    return {
      runtimePath: runtimeResult.runtimePath,
      data: runtimePayloadFromNote(note),
      source: 'note',
      note
    };
  }
  return { ...runtimeResult, source: 'runtime', note };
}

function writeDeliveryRuntime(update, options = {}) {
  const { repoRoot, state } = loadSchedulerState(options);
  const base = options.baseData
    ? { runtimePath: getDeliveryRuntimePath(repoRoot), data: options.baseData }
    : loadDeliveryMutableBase({ ...options, repoRoot });
  const { runtimePath, data } = base;
  const next = {
    ...data,
    version: 1,
    activeId: state.active_task?.id || null,
    commit: runGit(repoRoot, ['rev-parse', 'HEAD']),
    ...update,
    updatedAt: new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
  const temporaryPath = `${runtimePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, runtimePath);
  return { runtimePath, data: next };
}

function loadDeliveryNote(repoRoot, head, activeId) {
  const raw = runGit(repoRoot, [
    'notes',
    '--ref=price-v3-delivery',
    'show',
    head
  ], { allowFailure: true });
  if (!raw) return {};
  try {
    const note = JSON.parse(raw);
    if (note.activeId !== activeId || note.commit !== head) return {};
    let cursor = note;
    let depth = 0;
    while (cursor) {
      depth += 1;
      if (depth > DELIVERY_STATES.length + 5) throw new Error('attestation revision chain is unexpectedly deep');
      if (!cursor.attestationDigest || !cursor.contentDigest) {
        throw new Error('attestationDigest/contentDigest is missing');
      }
      const actualContentDigest = deliveryContentDigest(cursor);
      if (actualContentDigest !== cursor.contentDigest) {
        throw new Error(`content digest mismatch: expected ${cursor.contentDigest}, got ${actualContentDigest}`);
      }
      const actualAttestationDigest = sealedAttestationDigest(cursor);
      if (actualAttestationDigest !== cursor.attestationDigest) {
        throw new Error(`attestation digest mismatch: expected ${cursor.attestationDigest}, got ${actualAttestationDigest}`);
      }
      if (
        cursor.previousAttestation
        && cursor.previousAttestationDigest !== cursor.previousAttestation.attestationDigest
      ) {
        throw new Error('previous attestation pointer mismatch');
      }
      cursor = cursor.previousAttestation || null;
    }
    return note;
  } catch (error) {
    throw new Error(`delivery Git note is invalid: ${error.message}`);
  }
}

function sealDeliveryAttestation(options = {}) {
  const { repoRoot, state } = loadSchedulerState(options);
  const head = runGit(repoRoot, ['rev-parse', 'HEAD']);
  const existing = loadDeliveryNote(repoRoot, head, state.active_task?.id);
  let { runtimePath, data } = loadDeliveryMutableBase({ repoRoot, head, note: existing });
  if (data.activeId !== state.active_task?.id || data.commit !== head) {
    throw new Error('current HEAD has no matching delivery runtime evidence');
  }
  const stage = data.completionState || 'executing';
  const status = options.status || getDeliveryStatus(options);
  const check = checkDeliveryStage(stage, {
    ...options,
    status,
    skipSealCheck: true
  });
  if (!check.ok) {
    throw new Error(`delivery evidence cannot be sealed: ${check.blockers.join('; ')}`);
  }
  const currentContentDigest = deliveryContentDigest(data);
  if (existing.contentDigest === currentContentDigest) {
    return {
      commit: head,
      ref: DELIVERY_ATTESTATION_REF,
      runtimePath,
      digest: existing.attestationDigest,
      contentDigest: currentContentDigest,
      unchanged: true
    };
  }
  if (existing.attestationDigest) {
    const existingIndex = DELIVERY_STATES.indexOf(existing.completionState || 'executing');
    const nextIndex = DELIVERY_STATES.indexOf(stage);
    if (nextIndex < existingIndex) {
      throw new Error(`sealed attestation cannot move backwards: ${existing.completionState} -> ${stage}`);
    }
  }
  const gateSnapshot = {
    stage,
    checkedAt: new Date().toISOString(),
    head: check.status.git.head,
    originMain: check.status.git.originMain,
    remoteMain: check.status.git.remoteMain,
    remoteProduction: check.status.git.remoteProduction,
    defaultBranch: check.status.git.defaultBranch,
    originMainFresh: check.status.git.originMainFresh,
    originMainIsAncestor: check.status.git.originMainIsAncestor,
    mainIntegrated: check.status.git.mainIntegrated,
    localAttestationRefOid: check.status.localAttestationRefOid,
    remoteAttestationRefOid: check.status.remoteAttestationRefOid,
    remoteSnapshotCheckedAt: check.status.remoteSnapshot?.checkedAt || null,
    vercelProduction: check.status.vercelProduction || null,
    verifier: {
      remoteRefs: 'git ls-remote --symref origin HEAD refs/heads/main refs/heads/production refs/notes/price-v3-delivery',
      ancestor: 'git merge-base --is-ancestor origin/main HEAD',
      worktree: 'git status --porcelain=v1 --untracked-files=all',
      vercelProduction: 'pnpm exec vercel api <project|project-domain|production-deployment endpoint> --raw --non-interactive --no-color'
    }
  };
  const runtimeUpdate = writeDeliveryRuntime({
    gateSnapshots: {
      ...(data.gateSnapshots || {}),
      [stage]: gateSnapshot
    }
  }, { repoRoot, baseData: data });
  runtimePath = runtimeUpdate.runtimePath;
  data = runtimeUpdate.data;
  const contentDigest = deliveryContentDigest(data);
  const sealed = {
    ...data,
    previousAttestationDigest: existing.attestationDigest || null,
    previousAttestation: existing.attestationDigest ? existing : null,
    revision: (existing.revision || 0) + 1,
    contentDigest,
    sealedAt: new Date().toISOString()
  };
  sealed.attestationDigest = sealedAttestationDigest(sealed);
  const noteInputPath = `${runtimePath}.${process.pid}.note`;
  fs.writeFileSync(noteInputPath, `${JSON.stringify(sealed, null, 2)}\n`, { mode: 0o600 });
  const noteArgs = [
    'notes',
    '--ref=price-v3-delivery',
    'add',
    ...(existing.attestationDigest ? ['-f'] : []),
    '-F',
    noteInputPath,
    head
  ];
  const result = spawnSync('git', noteArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  fs.unlinkSync(noteInputPath);
  if (result.status !== 0) {
    throw new Error((result.stderr || 'failed to seal delivery Git note').trim());
  }
  return {
    commit: head,
    ref: DELIVERY_ATTESTATION_REF,
    runtimePath,
    digest: sealed.attestationDigest,
    contentDigest,
    unchanged: false
  };
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/.test(String(value || ''));
}

function resolveEvidenceArtifactPath(repoRoot, filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  const runtimeRoot = path.dirname(getDeliveryRuntimePath(repoRoot));
  const resolved = path.resolve(path.isAbsolute(filePath) ? filePath : path.join(runtimeRoot, filePath));
  const relative = path.relative(runtimeRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function artifactFileMatches(repoRoot, filePath, expectedSha256) {
  const resolved = resolveEvidenceArtifactPath(repoRoot, filePath);
  if (!resolved || !isSha256(expectedSha256) || !fs.existsSync(resolved)) return false;
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 25 * 1024 * 1024) return false;
  const actual = crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
  return actual === expectedSha256;
}

function evidenceEnvelopeValid(envelope, repoRoot) {
  if (
    !envelope
    || typeof envelope !== 'object'
    || !envelope.payload
    || typeof envelope.payload !== 'object'
    || !artifactFileMatches(repoRoot, envelope.artifact_path, envelope.sha256)
  ) {
    return false;
  }
  const resolved = resolveEvidenceArtifactPath(repoRoot, envelope.artifact_path);
  if (!resolved || path.extname(resolved).toLowerCase() !== '.json') return false;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    return false;
  }
  if (JSON.stringify(canonicalize(parsed)) !== JSON.stringify(canonicalize(envelope.payload))) return false;
  for (const attachment of parsed.attachments || []) {
    if (!artifactFileMatches(repoRoot, attachment.path, attachment.sha256)) return false;
  }
  return true;
}

function isExactProductionUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'https:'
      && parsed.hostname === VERCEL_PRODUCTION_CONTRACT.domain
      && parsed.port === ''
      && parsed.username === ''
      && parsed.password === '';
  } catch {
    return false;
  }
}

function hasForbiddenProductionEvidencePath(value) {
  const normalized = normalizeRelative(String(value || '')).toLowerCase();
  return normalized === 'output/playwright'
    || normalized.startsWith('output/playwright/')
    || normalized.includes('/output/playwright/');
}

function evidenceEnvelopeUnderPrefix(envelope, prefix) {
  const normalizedPrefix = `${normalizeRelative(prefix).toLowerCase()}/`;
  const paths = [
    envelope?.artifact_path,
    ...((envelope?.payload?.attachments || []).map((attachment) => attachment?.path))
  ].filter(Boolean).map((value) => normalizeRelative(String(value)).toLowerCase());
  return paths.length > 0 && paths.every((value) => value.startsWith(normalizedPrefix));
}

function productionBrowserOperatorAttestationBlockers(envelope, repoRoot, expected) {
  const blockers = [];
  if (!evidenceEnvelopeValid(envelope, repoRoot)) {
    return ['Production existing-Chrome operator attestation envelope is missing or invalid'];
  }

  const payload = envelope.payload || {};
  if (!isExactProductionUrl(payload.url)) {
    blockers.push(`Production browser acceptance must use https://${VERCEL_PRODUCTION_CONTRACT.domain}`);
  }
  if (payload.environment !== 'production') blockers.push('Production browser operator attestation environment is not production');
  if (payload.attestation_type !== 'trusted_operator_browser') blockers.push('Production browser evidence is not explicitly marked as a trusted operator attestation');
  if (payload.trust_boundary !== 'operator_attestation_not_machine_proof') blockers.push('Production browser attestation does not declare its human-session trust boundary');
  if (payload.attestation_method !== 'codex_chrome_control_existing_session') blockers.push('Production browser attestation method is not the existing Chrome control path');
  if (!String(payload.attested_by || '').trim()) blockers.push('Production browser operator attestation has no attester identity');
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(payload.attested_at || ''))) blockers.push('Production browser operator attestation timestamp is missing');
  if (!String(payload.existing_tab_id || '').trim()) blockers.push('Production browser operator attestation has no existing tab identity');
  if (payload.browser_context !== 'existing_user_chrome') blockers.push('Production browser operator attestation did not reuse the existing user Chrome session');
  if (payload.new_browser_contexts !== 0) blockers.push('Production browser operator attestation reports a new browser context');
  if (payload.new_tabs !== 0) blockers.push('Production browser operator attestation reports a new browser tab');
  if (payload.result !== 'pass') blockers.push('Production browser operator attestation did not pass');
  if (payload.commit !== expected.commit) blockers.push('Production browser operator attestation commit does not equal candidate HEAD');
  if (payload.deployment_id !== expected.deploymentId) blockers.push('Production browser operator attestation deployment does not equal live Production');
  if (!Array.isArray(payload.attachments) || payload.attachments.length === 0) blockers.push('Production browser operator attestation has no bound visual or trace attachment');
  if (hasForbiddenProductionEvidencePath(envelope.artifact_path)) {
    blockers.push('output/playwright cannot be used as final Production browser evidence');
  }
  for (const attachment of payload.attachments || []) {
    if (hasForbiddenProductionEvidencePath(attachment?.path)) {
      blockers.push('output/playwright cannot be used as final Production browser evidence');
    }
  }
  if (hasForbiddenProductionEvidencePath(payload.source_artifact)) {
    blockers.push('output/playwright cannot be used as final Production browser evidence');
  }
  return blockers;
}

function productionRuntimeEvidenceBlockers(evidence, requiredItems, repoRoot, expected) {
  const blockers = [];
  const section = evidence.production_runtime || {};
  const securityGate = section.security_gate;
  const runtimeVerifier = section.verifier;
  if (!evidenceEnvelopeValid(securityGate, repoRoot) || !evidenceEnvelopeUnderPrefix(securityGate, 'production-runtime-verifier')) {
    blockers.push('Production security gate has no valid controlled-verifier envelope');
  } else {
    const payload = securityGate.payload || {};
    if (payload.source !== 'live_production_database_verifier') blockers.push('Production security gate source is not the live database verifier');
    if (payload.gate_id !== 'SECURITY-P0-RLS-PRODUCTION' || payload.status !== 'passed') blockers.push('Production runtime evidence has not passed SECURITY-P0-RLS-PRODUCTION');
    if (payload.commit !== expected.commit || payload.deployment_id !== expected.deploymentId) blockers.push('Production security gate is not bound to released commit/deployment');
    if (!isExactProductionUrl(payload.origin)) blockers.push('Production security gate origin mismatch');
    if (!String(payload.production_project_ref || '').trim()) blockers.push('Production security gate project ref is missing');
    const requiredChecks = ['catalog', 'rls', 'acl', 'rpc', 'advisor', 'anon', 'service_role'];
    if (requiredChecks.some((name) => payload.checks?.[name] !== 'pass')) blockers.push('Production security gate raw checks are incomplete');
    if (!Array.isArray(payload.attachments) || payload.attachments.length < requiredChecks.length) blockers.push('Production security gate lacks raw database/API probe attachments');
  }
  if (!evidenceEnvelopeValid(runtimeVerifier, repoRoot) || !evidenceEnvelopeUnderPrefix(runtimeVerifier, 'production-runtime-verifier')) {
    blockers.push('Production runtime has no valid controlled-verifier envelope');
  } else {
    const payload = runtimeVerifier.payload || {};
    if (payload.source !== 'live_production_runtime_verifier') blockers.push('Production runtime verifier source is invalid');
    if (payload.commit !== expected.commit || payload.deployment_id !== expected.deploymentId) blockers.push('Production runtime verifier is not bound to released commit/deployment');
    if (!isExactProductionUrl(payload.origin)) blockers.push('Production runtime verifier origin mismatch');
    if (!Array.isArray(payload.attachments) || payload.attachments.length < 4) blockers.push('Production runtime verifier lacks raw provider/ReviewRun/invocation/token attachments');
  }
  for (const item of requiredItems) {
    const envelope = section[item];
    if (!evidenceEnvelopeValid(envelope, repoRoot) || !evidenceEnvelopeUnderPrefix(envelope, 'production-runtime-verifier')) {
      blockers.push(`Production runtime evidence envelope missing or invalid: ${item}`);
      continue;
    }
    const payload = envelope.payload || {};
    if (payload.commit !== expected.commit) blockers.push(`Production runtime evidence commit mismatch: ${item}`);
    if (payload.deployment_id !== expected.deploymentId) blockers.push(`Production runtime evidence deployment mismatch: ${item}`);
    if (payload.environment !== 'production') blockers.push(`Production runtime evidence environment mismatch: ${item}`);
    if (!isExactProductionUrl(payload.origin || payload.url)) blockers.push(`Production runtime evidence origin mismatch: ${item}`);
    if (!['production_api', 'production_database'].includes(payload.source)) blockers.push(`Production runtime evidence source mismatch: ${item}`);
    if (!Array.isArray(payload.attachments) || payload.attachments.length === 0) blockers.push(`Production runtime evidence has no raw response attachment: ${item}`);
  }

  if (requiredItems.includes('shipping_request')) {
    blockers.push(...shippingRuntimeEvidenceBlockers(section, 'production'));
    return blockers;
  }
  if (requiredItems.includes('shipping_workspace')) {
    blockers.push(...shippingWorkspaceEvidenceBlockers(section, 'production', expected.runtimeContractVersion));
    return blockers;
  }
  const reviewId = section.review_run?.payload?.review_id;
  if (!/^[0-9a-f-]{36}$/.test(String(reviewId || ''))) blockers.push('Production runtime ReviewRun ID is missing');
  if (!['COMPLETED', 'DEGRADED'].includes(String(section.review_run?.payload?.status || ''))) blockers.push('Production runtime ReviewRun is not completed');
  if (section.provider_probe?.payload?.success !== true) blockers.push('Production provider probe did not succeed');
  if (!String(section.provider_probe?.payload?.provider || '').trim()) blockers.push('Production provider probe identity is missing');
  if (!String(section.provider_probe?.payload?.model || '').trim()) blockers.push('Production provider probe model is missing');

  const invocationIds = section.model_invocations?.payload?.invocation_ids;
  if (!Array.isArray(invocationIds) || invocationIds.length === 0 || new Set(invocationIds).size !== invocationIds.length) {
    blockers.push('Production model_invocations evidence is empty or duplicated');
  }
  if (section.model_invocations?.payload?.review_id !== reviewId) blockers.push('Production model_invocations are not bound to ReviewRun');
  if (!(section.tokens?.payload?.total_tokens > 0)) blockers.push('Production token evidence is missing');
  if (section.tokens?.payload?.review_id !== reviewId) blockers.push('Production token evidence is not bound to ReviewRun');
  if (runtimeVerifier?.payload?.review_id !== reviewId) blockers.push('Production runtime verifier is not bound to ReviewRun');
  if (runtimeVerifier?.payload?.total_tokens !== section.tokens?.payload?.total_tokens) blockers.push('Production runtime verifier token total mismatch');

  const invocations = section.model_invocations?.payload?.invocations;
  if (!Array.isArray(invocations) || invocations.length === 0) {
    blockers.push('Production model_invocations evidence has no invocation details');
  } else {
    const detailedIds = invocations.map((item) => item?.id);
    if (detailedIds.some((id) => !String(id || '').trim()) || new Set(detailedIds).size !== detailedIds.length) blockers.push('Production model_invocations detail IDs are missing or duplicated');
    if (JSON.stringify([...new Set(invocationIds || [])].sort()) !== JSON.stringify([...new Set(detailedIds)].sort())) blockers.push('Production model_invocations IDs do not match invocation details');
    if (JSON.stringify([...(runtimeVerifier?.payload?.invocation_ids || [])].sort()) !== JSON.stringify([...new Set(detailedIds)].sort())) blockers.push('Production runtime verifier invocation IDs mismatch');
    if (invocations.some((item) => item?.review_id !== reviewId)) blockers.push('Production model_invocations details are not all bound to ReviewRun');
    if (invocations.some((item) => !String(item?.provider || '').trim() || !String(item?.model || '').trim())) blockers.push('Production model_invocations details are missing provider or model identity');
    if (invocations.some((item) => !['completed', 'failed'].includes(item?.status))) blockers.push('Production model_invocations details have an invalid status');
    if (invocations.some((item) => !Number.isInteger(item?.total_tokens) || item.total_tokens < 0)) blockers.push('Production model_invocations details have invalid token totals');
    const detailedTokenTotal = invocations.reduce((sum, item) => sum + (item?.total_tokens || 0), 0);
    if (detailedTokenTotal !== section.tokens?.payload?.total_tokens) blockers.push('Production token evidence does not equal model_invocations detail total');
  }
  return blockers;
}

function getBehaviorLogPath(repoRoot) {
  return path.join(path.dirname(getDeliveryRuntimePath(repoRoot)), 'behavior-log.jsonl');
}

function behaviorCheckArtifactsValid(repoRoot, entry, commitTree, firstParent) {
  const binding = entry?.aiBehavior?.evidenceBinding;
  const artifacts = binding?.checkArtifacts;
  const harnessScriptsRelativeDir = 'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本';
  const expected = new Map([
    ['harness-selftest', { filename: '00-harness-selftest.log', command: ['npm', '--prefix', harnessScriptsRelativeDir, 'test'] }],
    ...Array.from({ length: 10 }, (_, index) => {
      const number = String(index + 1).padStart(2, '0');
      const slugs = ['typecheck', 'lint', 'test', 'nav', 'git', 'feedback-loop', 'healthcheck', 'error-handling', 'business-loop', 'ci-cd-loop'];
      const name = `check-${number}-${slugs[index]}`;
      return [name, {
        filename: `${name}.log`,
        command: ['bash', path.join(repoRoot, 'governance/ai-behavior-准则/checks', `${name}.sh`)]
      }];
    })
  ]);
  const preCommitBaseMatches = binding?.baseCommit === firstParent || (
    /^[0-9a-f]{40,64}$/i.test(binding?.baseCommit || '')
    && (runGit(repoRoot, ['show', '--no-patch', '--format=%P', binding.baseCommit], { allowFailure: true }) || '')
      .split(' ')
      .filter(Boolean)[0] === firstParent
  );
  if (
    !Array.isArray(artifacts)
    || artifacts.length !== expected.size
    || !preCommitBaseMatches
    || binding.trackedWorkingTreeMatchesIndex !== true
    || binding.indexTreeStable !== true
    || binding.extraInputsStable !== true
    || binding.environmentFingerprint?.untrackedFileCount !== 0
    || binding.environmentFingerprint?.ignoredCheckInputCount !== 0
    || !isSha256(binding.environmentFingerprint?.extraInputSnapshotSha256)
  ) {
    return false;
  }

  const runtimeRoot = path.dirname(getDeliveryRuntimePath(repoRoot));
  const expectedDirectory = path.resolve(runtimeRoot, 'check-logs', commitTree);
  const seenNames = new Set();
  const seenPaths = new Set();
  for (const artifact of artifacts) {
    const contract = expected.get(artifact?.name);
    const resolved = resolveEvidenceArtifactPath(repoRoot, artifact?.artifact_path);
    if (
      !contract
      || !resolved
      || path.dirname(resolved) !== expectedDirectory
      || path.basename(resolved) !== contract.filename
      || seenNames.has(artifact.name)
      || seenPaths.has(resolved)
      || artifact.exit_code !== 0
      || artifact.timeout !== false
      || !Array.isArray(artifact.command)
      || artifact.command.length !== contract.command.length
      || artifact.command.some((part, index) => part !== contract.command[index])
      || !isSha256(artifact.sha256)
      || !fs.existsSync(resolved)
    ) {
      return false;
    }
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 25 * 1024 * 1024) return false;
    if (fileSha256(resolved) !== artifact.sha256) return false;
    seenNames.add(artifact.name);
    seenPaths.add(resolved);
  }
  return [...expected.keys()].every((name) => seenNames.has(name));
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function loadBehaviorLogProof(repoRoot, head) {
  const logPath = getBehaviorLogPath(repoRoot);
  if (!fs.existsSync(logPath)) {
    return { ok: false, blocker: 'current worktree behavior log is missing' };
  }
  const stat = fs.statSync(logPath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 25 * 1024 * 1024) {
    return { ok: false, blocker: 'current worktree behavior log is empty or oversized' };
  }

  const entries = [];
  for (const [index, line] of fs.readFileSync(logPath, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      return { ok: false, blocker: `current worktree behavior log has invalid JSON at line ${index + 1}` };
    }
  }

  const commitTree = runGit(repoRoot, ['show', '--no-patch', '--format=%T', head]);
  const firstParent = runGit(repoRoot, ['show', '--no-patch', '--format=%P', head])
    .split(' ')
    .filter(Boolean)[0] || 'unborn';
  const entry = [...entries].reverse().find((item) => (
    item?.trigger === 'post-commit'
    && item?.commit === head
    && item?.commitTree === commitTree
    && item?.aiBehavior?.checked === true
    && item?.aiBehavior?.evidenceBinding?.trigger === 'pre-commit'
    && item?.aiBehavior?.evidenceBinding?.indexTree === commitTree
    && item?.aiBehavior?.evidenceBinding?.controlPreflight === 'harness-selftest'
    && item?.aiBehavior?.evidenceBinding?.requiredChecks === 10
    && item?.aiBehavior?.evidenceBinding?.executedChecks === 10
    && item?.aiBehavior?.evidenceBinding?.passed === 10
    && item?.aiBehavior?.evidenceBinding?.failed === 0
    && behaviorCheckArtifactsValid(repoRoot, item, commitTree, firstParent)
  ));
  if (!entry) {
    return { ok: false, blocker: 'behavior log has no verified post-commit record for current HEAD' };
  }

  return {
    ok: true,
    artifactPath: 'behavior-log.jsonl',
    sha256: fileSha256(logPath),
    entrySha256: sha256Canonical(entry),
    entry
  };
}

function unresolvedBlockingDefects(state, runtimeDefects = {}, head = '', previewArtifacts = {}, productionArtifacts = {}, repoRoot = '', stage = 'production_released') {
  const configured = new Set(state.active_task?.delivery_contract?.blocking_acceptance_defects || []);
  if (!configured.size) return [];
  // Integration consumes current-SHA Preview replay. Production closure still
  // requires a separate replay on the released Production deployment.
  const productionTarget = stage === 'production_released' && state.active_task?.delivery_contract?.target_state === 'production_released';
  const resolved = new Set();
  for (const [id, proof] of Object.entries(runtimeDefects)) {
    const previewVerified = (
      configured.has(id)
      && proof?.verified === true
      && typeof proof.root_cause === 'string'
      && proof.root_cause.trim().length >= 20
      && evidenceEnvelopeValid(proof.reproduction, repoRoot)
      && evidenceEnvelopeValid(previewArtifacts.defect_replay, repoRoot)
      && proof.regression_artifact_sha256 === previewArtifacts.defect_replay.sha256
      && proof.preview_commit === head
    );
    const productionVerified = !productionTarget || (
      proof?.production_verified === true
      && evidenceEnvelopeValid(productionArtifacts.browser_acceptance, repoRoot)
      && JSON.stringify(productionArtifacts.browser_acceptance?.payload?.actions) === JSON.stringify(requiredReplayActions(state))
      && proof.production_regression_artifact_sha256 === productionArtifacts.browser_acceptance.sha256
      && proof.production_commit === head
    );
    if (previewVerified && productionVerified) {
      resolved.add(id);
    }
  }
  return [...configured].filter((id) => !resolved.has(id));
}

function getDeliveryStatus(options = {}) {
  const { repoRoot, state } = loadSchedulerState(options);
  const { records: inboxRecords, parseErrors } = loadDemandInbox({ repoRoot });
  const scheduler = validateSchedulerState({ repoRoot });
  const {
    statePath: harnessStatePath,
    contractPath: goalContractPath
  } = resolveHarnessRuntimePaths(repoRoot);
  const harnessState = fs.existsSync(harnessStatePath)
    ? JSON.parse(fs.readFileSync(harnessStatePath, 'utf8'))
    : null;
  const goalContract = fs.existsSync(goalContractPath)
    ? JSON.parse(fs.readFileSync(goalContractPath, 'utf8'))
    : null;
  const head = runGit(repoRoot, ['rev-parse', 'HEAD']);
  const originMain = runGit(repoRoot, ['rev-parse', 'refs/remotes/origin/main'], { allowFailure: true });
  const remoteSnapshot = options.remoteSnapshot || readRemoteSnapshot(repoRoot);
  const remoteMain = remoteSnapshot.main;
  const remoteProduction = remoteSnapshot.production;
  const defaultBranch = remoteSnapshot.defaultBranch;
  const originMainFresh = Boolean(originMain && remoteMain && originMain === remoteMain);
  const originMainIsAncestor = originMainFresh
    ? runGit(repoRoot, ['merge-base', '--is-ancestor', originMain, head], { allowFailure: true }) !== null
    : false;
  const worktreeIsolation = inspectGitWorktreeIsolation(repoRoot);
  const worktreeStatus = !worktreeIsolation.ok
    ? null
    : runGit(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  const note = loadDeliveryNote(repoRoot, head, state.active_task?.id);
  const { runtimePath, data: runtime } = loadDeliveryRuntime({ repoRoot });
  const runtimeStateIndex = DELIVERY_STATES.indexOf(runtime.completionState || 'executing');
  const noteStateIndex = DELIVERY_STATES.indexOf(note.completionState || 'executing');
  const attestation = runtime.commit && (!note.commit || runtimeStateIndex >= noteStateIndex)
    ? runtime
    : note;
  const currentContentDigest = attestation.commit
    ? deliveryContentDigest(attestation)
    : null;
  const attestationSealed = Boolean(
    note.contentDigest
    && currentContentDigest
    && note.contentDigest === currentContentDigest
  );
  const localAttestationRefOid = runGit(repoRoot, ['rev-parse', DELIVERY_ATTESTATION_REF], { allowFailure: true });
  const remoteAttestationRefOid = remoteSnapshot.attestation;
  const attestationPublished = Boolean(
    attestationSealed
    && localAttestationRefOid
    && remoteAttestationRefOid
    && localAttestationRefOid === remoteAttestationRefOid
  );
  const evidence = attestation.evidence || {};
  const releaseControl = attestation.releaseControl || {};
  const finalReleaseApprovalId = state.active_task?.delivery_contract?.production_release_authorization?.final_release_approval_id;
  const productionReleaseAuthorizationRecord = inboxRecords.find((record) => record?.id === finalReleaseApprovalId) || null;
  let completionState = attestation.completionState || 'executing';
  if (deliveryStateAtLeast(completionState, 'code_green') && evidence.code?.commit !== head) {
    completionState = 'executing';
  } else if (
    deliveryStateAtLeast(completionState, 'clean_preview_green')
    && evidence.preview?.commit !== head
  ) {
    completionState = 'code_green';
  }

  return {
    ok: scheduler.ok && parseErrors.length === 0,
    repoRoot,
    activeId: state.active_task?.id || null,
    featureId: state.active_task?.feature_id || null,
    targetState: state.active_task?.delivery_contract?.target_state || null,
    allowedStates: state.active_task?.delivery_contract?.allowed_states || [],
    requiredCodeChecks: state.active_task?.delivery_contract?.required_code_checks || [],
    runtimeProfile: runtimeProfileOf(state),
    runtimeContractVersion: runtimeContractVersionOf(state),
    requiredReplayActions: requiredReplayActions(state),
    requiredRuntimeEvidence: state.active_task?.delivery_contract?.required_runtime_evidence || [],
    requiredProductionRuntimeEvidence: state.active_task?.delivery_contract?.required_production_runtime_evidence || [],
    productionReleaseAuthorization: state.active_task?.delivery_contract?.production_release_authorization || null,
    productionReleaseAuthorizationRecord,
    productionDatabaseMode: state.active_task?.delivery_contract?.final_acceptance?.production_database_mode || null,
    sameReleaseCommitRequired: state.active_task?.delivery_contract?.same_release_commit_required === true,
    completionState,
    scheduler,
    harness: {
      mode: harnessState?.mode || null,
      phase: harnessState?.phase || null,
      activeGate: harnessState?.activeGates?.[0] || null,
      workPackageId: harnessState?.currentGoal?.workPackageId || goalContract?.workPackageId || null,
      goalStatus: goalContract?.status || null
    },
    git: {
      head,
      originMain,
      remoteMain,
      remoteProduction,
      defaultBranch,
      originMainFresh,
      worktreeIsolation,
      commonCoreWorktree: worktreeIsolation.configEntries,
      clean: worktreeIsolation.ok ? worktreeStatus.length === 0 : false,
      dirtyEntries: worktreeIsolation.ok ? (worktreeStatus ? worktreeStatus.split(/\r?\n/).length : 0) : null,
      originMainIsAncestor,
      mainIntegrated: Boolean(remoteMain && runGit(repoRoot, ['merge-base', '--is-ancestor', head, remoteMain], { allowFailure: true }) !== null)
    },
    evidence,
    evidenceStore: runtimePath,
    attestationRef: DELIVERY_ATTESTATION_REF,
    attestationDigest: attestationSealed ? note.attestationDigest : null,
    contentDigest: currentContentDigest,
    attestationSealed,
    attestationPublished,
    localAttestationRefOid,
    remoteAttestationRefOid,
    remoteSnapshot,
    sealedCompletionState: attestationSealed ? note.completionState || null : null,
    releaseControl,
    gateSnapshots: attestation.gateSnapshots || {},
    vercelProduction: attestation.gateSnapshots?.[completionState]?.vercelProduction || null,
    previewBlockingDefects: unresolvedBlockingDefects(
      state,
      evidence.preview?.journeys?.blocking_defect_replay === true ? (attestation.defects || {}) : {},
      head, evidence.preview?.artifacts || {}, {}, repoRoot, 'clean_preview_green'
    ),
    blockingDefects: unresolvedBlockingDefects(
      state,
      evidence.preview?.journeys?.blocking_defect_replay === true
        ? (attestation.defects || {})
        : {},
      head,
      evidence.preview?.artifacts || {},
      evidence.production || {},
      repoRoot
    )
  };
}

function checkDeliveryStage(stage, options = {}) {
  if (!DELIVERY_STATES.includes(stage)) {
    return { ok: false, stage, blockers: [`unknown delivery stage: ${stage}`] };
  }
  const status = options.status || getDeliveryStatus(options);
  const repoRoot = options.repoRoot || status.repoRoot;
  const blockers = [];
  const evidence = status.evidence;
  const productionTerminal = stage === 'production_released';

  if (status.git.worktreeIsolation && !status.git.worktreeIsolation.ok) {
    blockers.push(...status.git.worktreeIsolation.blockers);
  }

  if (!status.allowedStates.includes(stage)) blockers.push(`delivery stage is not allowed by Active contract: ${stage}`);
  if (
    DELIVERY_STATES.indexOf(stage) > DELIVERY_STATES.indexOf(status.targetState)
  ) {
    blockers.push(`delivery stage ${stage} exceeds approved target ${status.targetState || 'missing'}`);
  }

  if (!status.scheduler.ok) blockers.push(...status.scheduler.errors);
  if (status.harness.mode !== 'enforcing') blockers.push('Harness is not enforcing');
  if (status.harness.workPackageId !== status.activeId) blockers.push('Harness is not bound to Active WP');
  if (!status.harness.activeGate) blockers.push('Harness has no active gate');
  if (!options.skipStateCheck && !deliveryStateAtLeast(status.completionState, stage)) {
    blockers.push(`completion_state ${status.completionState} has not reached ${stage}`);
  }

  if (deliveryStateAtLeast(stage, 'code_green')) {
    if (status.harness.phase !== 'verify' || status.harness.activeGate !== 'HG4') {
      blockers.push(`delivery verification requires Harness verify/HG4, got ${status.harness.phase || 'missing'}/${status.harness.activeGate || 'missing'}`);
    }
    if (!status.git.clean) blockers.push(`worktree is dirty (${status.git.dirtyEntries} entries)`);
    if (evidence.code?.commit !== status.git.head) blockers.push('code evidence commit does not equal HEAD');
    const behaviorProof = loadBehaviorLogProof(repoRoot, status.git.head);
    if (!behaviorProof.ok) {
      blockers.push(behaviorProof.blocker);
    } else {
      const recordedBehavior = evidence.code?.behavior_log;
      const recordedPath = resolveEvidenceArtifactPath(repoRoot, recordedBehavior?.artifact_path);
      if (
        !recordedBehavior
        || recordedPath !== getBehaviorLogPath(repoRoot)
        || recordedBehavior.sha256 !== behaviorProof.sha256
        || recordedBehavior.entry_sha256 !== behaviorProof.entrySha256
      ) {
        blockers.push('code evidence is not bound to the verified current-HEAD behavior log');
      }
    }
    for (const check of status.requiredCodeChecks) {
      if (evidence.code?.checks?.[check] !== true) blockers.push(`code check missing: ${check}`);
    }
    const commandEvidence = Array.isArray(evidence.code?.commands) ? evidence.code.commands : [];
    for (const name of status.requiredCodeChecks) {
      const command = commandEvidence.find((item) => item?.name === name);
      if (
        !command
        || command.exit_code !== 0
        || !artifactFileMatches(repoRoot, command.artifact_path, command.log_sha256)
      ) {
        blockers.push(`code command artifact missing or invalid: ${name}`);
      }
    }
  }
  if (deliveryStateAtLeast(stage, 'clean_preview_green')) {
    if (evidence.preview?.commit !== status.git.head) blockers.push('Preview commit does not equal HEAD');
    if (evidence.preview?.provider_source_commit !== status.git.head) blockers.push('Preview provider source commit does not equal HEAD');
    if (!/^dpl_[A-Za-z0-9]+$/.test(String(evidence.preview?.deployment_id || ''))) blockers.push('Preview deployment ID is missing');
    if (!/^https:\/\//.test(String(evidence.preview?.url || ''))) blockers.push('Preview URL is missing');
    if (evidence.preview?.ready !== true) blockers.push('Preview is not READY');
    if (evidence.preview?.git_dirty !== false) blockers.push('Preview was built from dirty source');
    for (const journey of ['desktop', 'ipad', 'blocking_defect_replay']) {
      if (evidence.preview?.journeys?.[journey] !== true) blockers.push(`Preview journey missing: ${journey}`);
    }
    for (const artifact of ['desktop', 'ipad', 'defect_replay']) {
      if (!evidenceEnvelopeValid(evidence.preview?.artifacts?.[artifact], repoRoot)) blockers.push(`Preview evidence envelope missing or invalid: ${artifact}`);
    }
    if ((evidence.preview?.artifacts?.desktop?.payload?.viewport?.width || 0) < 1200) blockers.push('desktop Preview evidence has no desktop viewport');
    const ipadWidth = evidence.preview?.artifacts?.ipad?.payload?.viewport?.width || 0;
    if (ipadWidth < 768 || ipadWidth > 1366) blockers.push('iPad Preview evidence has no tablet viewport');
    const defectReplayPayload = evidence.preview?.artifacts?.defect_replay?.payload;
    if (defectReplayPayload?.commit !== status.git.head) blockers.push('defect replay payload commit does not equal HEAD');
    if (defectReplayPayload?.deployment_id !== evidence.preview?.deployment_id) blockers.push('defect replay payload deployment does not equal Preview deployment');
    if (!/^https:\/\//.test(String(defectReplayPayload?.url || ''))) blockers.push('defect replay payload has no HTTPS URL');
    if (JSON.stringify(defectReplayPayload?.actions) !== JSON.stringify(status.requiredReplayActions)) blockers.push('defect replay payload does not contain the complete ordered action sequence');
    if (defectReplayPayload?.result !== 'pass') blockers.push('defect replay did not pass');
    if (defectReplayPayload?.overlays_after !== 0) blockers.push('defect replay left overlays behind');
    if (defectReplayPayload?.body_scroll_lock_released !== true) blockers.push('defect replay did not release body scroll lock');
    if (defectReplayPayload?.app_inert_after !== false) blockers.push('defect replay left the application inert');
    for (const item of status.requiredRuntimeEvidence) {
      const envelope = evidence.runtime?.[item];
      if (!evidenceEnvelopeValid(envelope, repoRoot)) {
        blockers.push(`runtime evidence envelope missing or invalid: ${item}`);
      } else {
        if (envelope.payload.commit !== status.git.head) blockers.push(`runtime evidence commit mismatch: ${item}`);
        if (envelope.payload.deployment_id !== evidence.preview?.deployment_id) blockers.push(`runtime evidence deployment mismatch: ${item}`);
        if (['f054-v2', 'f054-ui-v1'].includes(status.runtimeContractVersion)) {
          try {
            const origin = new URL(envelope.payload.origin);
            if (origin.protocol !== 'https:' || origin.origin !== new URL(evidence.preview.url).origin) blockers.push(`runtime evidence origin mismatch: ${item}`);
          } catch { blockers.push(`runtime evidence origin missing or invalid: ${item}`); }
        }
      }
    }
    if (status.runtimeProfile === 'shipping_workspace') {
      blockers.push(...shippingWorkspaceEvidenceBlockers(evidence.runtime || {}, 'sandbox', status.runtimeContractVersion));
    } else if (status.runtimeProfile === 'shipping') {
      blockers.push(...shippingRuntimeEvidenceBlockers(evidence.runtime || {}, 'sandbox'));
    } else {
    const runtimeReviewId = evidence.runtime?.review_run?.payload?.review_id;
    if (!/^[0-9a-f-]{36}$/.test(String(runtimeReviewId || ''))) blockers.push('runtime ReviewRun ID is missing');
    if (!['COMPLETED', 'DEGRADED'].includes(String(evidence.runtime?.review_run?.payload?.status || ''))) blockers.push('runtime ReviewRun is not completed');
    if (evidence.runtime?.provider_probe?.payload?.success !== true) blockers.push('provider probe did not succeed');
    if (!String(evidence.runtime?.provider_probe?.payload?.provider || '').trim()) blockers.push('provider probe identity is missing');
    if (!String(evidence.runtime?.provider_probe?.payload?.model || '').trim()) blockers.push('provider probe model is missing');
    const invocationIds = evidence.runtime?.model_invocations?.payload?.invocation_ids;
    if (!Array.isArray(invocationIds) || invocationIds.length === 0 || new Set(invocationIds).size !== invocationIds.length) blockers.push('model_invocations evidence is empty or duplicated');
    if (evidence.runtime?.model_invocations?.payload?.review_id !== runtimeReviewId) blockers.push('model_invocations are not bound to ReviewRun');
    if (!(evidence.runtime?.tokens?.payload?.total_tokens > 0)) blockers.push('token evidence is missing');
    if (evidence.runtime?.tokens?.payload?.review_id !== runtimeReviewId) blockers.push('token evidence is not bound to ReviewRun');
    const invocations = evidence.runtime?.model_invocations?.payload?.invocations;
    if (!Array.isArray(invocations) || invocations.length === 0) {
      blockers.push('model_invocations evidence has no invocation details');
    } else {
      const detailedIds = invocations.map((item) => item?.id);
      if (detailedIds.some((id) => !String(id || '').trim()) || new Set(detailedIds).size !== detailedIds.length) blockers.push('model_invocations detail IDs are missing or duplicated');
      const recordedIds = [...new Set(invocationIds || [])].sort();
      const normalizedDetailedIds = [...new Set(detailedIds)].sort();
      if (JSON.stringify(recordedIds) !== JSON.stringify(normalizedDetailedIds)) blockers.push('model_invocations IDs do not match invocation details');
      if (invocations.some((item) => item?.review_id !== runtimeReviewId)) blockers.push('model_invocations details are not all bound to ReviewRun');
      if (invocations.some((item) => !String(item?.provider || '').trim() || !String(item?.model || '').trim())) blockers.push('model_invocations details are missing provider or model identity');
      if (invocations.some((item) => !['completed', 'failed'].includes(item?.status))) blockers.push('model_invocations details have an invalid status');
      if (invocations.some((item) => !Number.isInteger(item?.total_tokens) || item.total_tokens < 0)) blockers.push('model_invocations details have invalid token totals');
      const completedProbeInvocation = invocations.find((item) => (
        item.status === 'completed'
        && item.provider === evidence.runtime?.provider_probe?.payload?.provider
        && item.model === evidence.runtime?.provider_probe?.payload?.model
      ));
      if (!completedProbeInvocation) blockers.push('provider probe does not match a completed model invocation');
      const detailedTokenTotal = invocations.reduce((sum, item) => sum + (Number.isInteger(item?.total_tokens) ? item.total_tokens : 0), 0);
      if (detailedTokenTotal !== evidence.runtime?.tokens?.payload?.total_tokens) blockers.push('token evidence does not equal model_invocations detail total');
    }
    }
  }
  if (deliveryStateAtLeast(stage, 'integration_ready') && !productionTerminal) {
    const liveVercel = verifyVercelProductionState(repoRoot, status.git.remoteProduction, {
      stage,
      testOnlyVercelApiResponses: options.testOnlyVercelApiResponses
    });
    status.vercelProduction = liveVercel.snapshot;
    blockers.push(...liveVercel.blockers);
    const previewDefects = status.previewBlockingDefects || status.blockingDefects;
    if (previewDefects.length) blockers.push(`blocking defects unresolved in Preview: ${previewDefects.join(', ')}`);
    if (!status.git.originMainFresh) blockers.push('origin/main is stale; fetch origin before integration');
    if (stage === 'integration_ready' && !status.git.originMainIsAncestor) blockers.push('origin/main is not an ancestor of candidate HEAD');
    if (status.releaseControl.production_branch !== 'production') blockers.push('Production Branch isolation is not recorded as production');
    if (!/^prj_[A-Za-z0-9]+$/.test(String(status.releaseControl.vercel_project_id || ''))) blockers.push('Vercel project ID is missing');
    if (!evidenceEnvelopeValid(status.releaseControl.production_branch_evidence, repoRoot)) blockers.push('Vercel Production Branch evidence is missing or invalid');
    if (status.releaseControl.production_branch_evidence?.payload?.branch !== 'production') blockers.push('Vercel Production Branch evidence does not show production');
    if (status.releaseControl.production_branch_evidence?.payload?.project_id !== status.releaseControl.vercel_project_id) blockers.push('Vercel Production Branch evidence project mismatch');
    if (!Number.isFinite(Date.parse(status.releaseControl.production_branch_evidence?.payload?.observed_at || ''))) blockers.push('Vercel Production Branch evidence timestamp is invalid');
    if (!status.git.remoteProduction) blockers.push('remote production branch is missing');
    if (!status.releaseControl.production_commit_before) blockers.push('Production commit before integration is missing');
    if (status.releaseControl.production_commit_before !== status.git.remoteProduction) blockers.push('Production branch OID does not equal recorded pre-integration anchor');
    if (!/^dpl_[A-Za-z0-9]+$/.test(String(status.releaseControl.production_deployment_id_before || ''))) blockers.push('Production deployment ID before integration is missing');
    if (liveVercel.snapshot?.project?.id !== status.releaseControl.vercel_project_id) blockers.push('live Vercel project does not equal recorded release-control project');
    if (liveVercel.snapshot?.deployment?.id !== status.releaseControl.production_deployment_id_before) blockers.push('live Vercel Production deployment does not equal recorded pre-integration deployment');
    if (liveVercel.snapshot?.deployment?.gitCommitSha !== status.releaseControl.production_commit_before) blockers.push('live Vercel Production source does not equal recorded pre-integration source');
    if (
      !options.skipSealCheck
      && !deliveryStateAtLeast(status.sealedCompletionState, stage)
    ) {
      blockers.push(`Git note attestation has not been sealed for ${stage}`);
    }
    if (!options.skipSealCheck && !status.attestationPublished) {
      blockers.push(`Git note attestation has not been pushed to ${DELIVERY_ATTESTATION_REF}`);
    }
    if (!options.skipSealCheck) {
      const snapshot = status.gateSnapshots?.[stage];
      if (!snapshot || snapshot.stage !== stage || snapshot.head !== status.git.head) {
        blockers.push(`machine gate snapshot is missing for ${stage}`);
      } else if (
        snapshot.originMain !== snapshot.remoteMain
        || snapshot.originMainFresh !== true
        || (stage === 'integration_ready' ? snapshot.originMainIsAncestor !== true : snapshot.mainIntegrated !== true)
      ) {
        blockers.push(`machine gate snapshot did not prove fresh ancestor state for ${stage}`);
      }
      if (
        !snapshot?.vercelProduction
        || !isSha256(snapshot.vercelProduction.raw?.project?.sha256)
        || !isSha256(snapshot.vercelProduction.raw?.domain?.sha256)
        || !isSha256(snapshot.vercelProduction.raw?.deployment?.sha256)
      ) {
        blockers.push(`machine gate snapshot has no hashed live Vercel evidence for ${stage}`);
      }
    }
  }
  if (deliveryStateAtLeast(stage, 'main_integrated') && !productionTerminal) {
    if (!status.git.mainIntegrated) blockers.push('origin/main does not contain candidate HEAD');
    if (status.git.defaultBranch !== 'main') blockers.push(`GitHub default branch is ${status.git.defaultBranch || 'unknown'}, expected main`);
    if (!status.releaseControl.production_commit_after) blockers.push('Production commit after main integration is missing');
    if (!/^dpl_[A-Za-z0-9]+$/.test(String(status.releaseControl.production_deployment_id_after || ''))) blockers.push('Production deployment ID after main integration is missing');
    if (status.releaseControl.production_commit_before !== status.releaseControl.production_commit_after) blockers.push('Production source anchor changed during main integration');
    if (status.releaseControl.production_deployment_id_before !== status.releaseControl.production_deployment_id_after) blockers.push('Production deployment changed during main integration');
    if (status.releaseControl.production_commit_after !== status.git.remoteProduction) blockers.push('remote production branch changed during main integration');
    if (status.vercelProduction?.deployment?.id !== status.releaseControl.production_deployment_id_after) blockers.push('live Vercel Production deployment does not equal recorded post-integration deployment');
    if (status.vercelProduction?.deployment?.gitCommitSha !== status.releaseControl.production_commit_after) blockers.push('live Vercel Production source does not equal recorded post-integration source');
    if (!options.skipSealCheck) {
      const snapshot = status.gateSnapshots?.main_integrated;
      if (!snapshot || snapshot.remoteMain !== status.git.remoteMain || snapshot.mainIntegrated !== true || snapshot.defaultBranch !== 'main') {
        blockers.push('main-integrated machine snapshot is incomplete');
      }
    }
  }
  if (productionTerminal) {
    const liveVercel = verifyVercelProductionState(repoRoot, status.git.remoteProduction, {
      stage,
      testOnlyVercelApiResponses: options.testOnlyVercelApiResponses
    });
    status.vercelProduction = liveVercel.snapshot;
    blockers.push(...liveVercel.blockers);

    if (status.blockingDefects.length) blockers.push(`blocking defects unresolved: ${status.blockingDefects.join(', ')}`);
    if (!status.git.mainIntegrated) blockers.push('origin/main does not equal released candidate HEAD');
    if (status.git.defaultBranch !== 'main') blockers.push(`GitHub default branch is ${status.git.defaultBranch || 'unknown'}, expected main`);
    if (status.git.remoteProduction !== status.git.head) blockers.push('origin/production does not equal released candidate HEAD');
    const codeOnly = status.productionReleaseAuthorization?.status === 'approved_code_only';
    if (!codeOnly && status.productionReleaseAuthorization?.status !== 'approved_for_final_release') blockers.push('Final Production release authorization is still pending');
    if (codeOnly ? status.productionDatabaseMode !== 'read_only' || status.runtimeContractVersion !== 'f054-ui-v1' : status.productionDatabaseMode !== 'controlled_write_approved') blockers.push('Production database boundary does not match the authorized release mode');
    const approvalRecord = status.productionReleaseAuthorizationRecord;
    if (approvalRecord?.type !== 'final_production_release_authorization') blockers.push('Final Production authorization record type is invalid');
    if (approvalRecord?.state !== 'approved') blockers.push('Final Production authorization record is not approved');
    if (approvalRecord?.source !== 'user_explicit') blockers.push('Final Production authorization is not sourced from an explicit user decision');
    if (approvalRecord?.scope !== status.productionReleaseAuthorization?.final_scope) blockers.push('Final Production authorization record scope does not match the Active contract');
    if (codeOnly) {
      if (approvalRecord?.code_release_authorized !== true || approvalRecord?.production_database_write_authorized !== false) blockers.push('Explicit code-only Production authority is missing');
    } else if (approvalRecord?.production_write_authorized !== true) blockers.push('Final Production authorization does not explicitly allow the controlled Production write');
    if (approvalRecord?.authorized_commit_binding !== 'delivery_attestation_current_head') blockers.push('Final Production authorization does not require exact-HEAD delivery attestation binding');
    if (status.releaseControl.production_release_approval_id !== status.productionReleaseAuthorization?.final_release_approval_id) blockers.push('Production release approval ID does not match the Active final-release contract');
    if (status.releaseControl.production_release_clarification_id !== status.productionReleaseAuthorization?.clarification_id) blockers.push('Production release clarification ID does not match the Active contract');
    if (status.releaseControl.production_release_scope !== status.productionReleaseAuthorization?.final_scope) blockers.push('Production release scope does not match the Active final-release contract');
    if (status.releaseControl.production_release_commit_authorized !== status.git.head) blockers.push('Production release authorization record is not bound to candidate HEAD');
    if (!['vercel_git_production_branch', 'vercel_cli_exact_sha'].includes(status.releaseControl.production_release_method)) blockers.push('Production release method is missing or unsupported');
    if (!/^\d{4}-\d{2}-\d{2}T/.test(String(status.releaseControl.production_released_at || ''))) blockers.push('Production released_at timestamp is missing');
    if (status.releaseControl.production_branch !== VERCEL_PRODUCTION_CONTRACT.productionBranch) blockers.push('Production Branch isolation is not recorded as production');
    if (status.releaseControl.vercel_project_id !== VERCEL_PRODUCTION_CONTRACT.projectId) blockers.push('released Vercel project ID does not match the Production contract');
    if (status.releaseControl.production_commit_released !== status.git.head) blockers.push('recorded released Production commit does not equal candidate HEAD');
    if (status.releaseControl.production_deployment_id_released !== liveVercel.snapshot?.deployment?.id) blockers.push('recorded released Production deployment does not equal live Production');
    if (status.releaseControl.production_domain_released !== VERCEL_PRODUCTION_CONTRACT.domain) blockers.push('recorded released Production domain does not match the product domain');
    if (evidence.production?.commit !== status.git.head) blockers.push('Production evidence commit does not equal candidate HEAD');
    if (evidence.production?.deployment_id !== liveVercel.snapshot?.deployment?.id) blockers.push('Production evidence deployment does not equal live Production');
    if (evidence.production?.domain !== VERCEL_PRODUCTION_CONTRACT.domain) blockers.push('Production evidence domain does not match the product domain');
    blockers.push(...productionRuntimeEvidenceBlockers(
      evidence,
      status.requiredProductionRuntimeEvidence,
      repoRoot,
      {
        commit: status.git.head,
        deploymentId: liveVercel.snapshot?.deployment?.id,
        runtimeContractVersion: status.runtimeContractVersion
      }
    ));
    blockers.push(...productionBrowserOperatorAttestationBlockers(
      evidence.production?.browser_acceptance,
      repoRoot,
      {
        commit: status.git.head,
        deploymentId: liveVercel.snapshot?.deployment?.id
      }
    ));

    if (!options.skipSealCheck && !deliveryStateAtLeast(status.sealedCompletionState, stage)) {
      blockers.push(`Git note attestation has not been sealed for ${stage}`);
    }
    if (!options.skipSealCheck && !status.attestationPublished) {
      blockers.push(`Git note attestation has not been pushed to ${DELIVERY_ATTESTATION_REF}`);
    }
    if (!options.skipSealCheck) {
      const snapshot = status.gateSnapshots?.production_released;
      if (
        !snapshot
        || snapshot.stage !== 'production_released'
        || snapshot.head !== status.git.head
        || snapshot.remoteProduction !== status.git.head
        || snapshot.vercelProduction?.deployment?.id !== evidence.production?.deployment_id
        || snapshot.vercelProduction?.deployment?.gitCommitSha !== status.git.head
        || snapshot.vercelProduction?.domain?.name !== VERCEL_PRODUCTION_CONTRACT.domain
      ) {
        blockers.push('Production-released machine snapshot is incomplete or not bound to the released SHA/domain');
      }
      if (
        !snapshot?.vercelProduction
        || !isSha256(snapshot.vercelProduction.raw?.project?.sha256)
        || !isSha256(snapshot.vercelProduction.raw?.domain?.sha256)
        || !isSha256(snapshot.vercelProduction.raw?.deployment?.sha256)
      ) {
        blockers.push('Production-released machine snapshot has no hashed live Vercel evidence');
      }
    }
  }

  return { ok: blockers.length === 0, stage, blockers, status };
}

const LIVE_SHIPPING_WORKSPACE_RECEIPT = Symbol('live shipping workspace verifier receipt');
async function verifyShippingWorkspaceProduction(options = {}) {
  const status = getDeliveryStatus(options), repoRoot = status.repoRoot;
  const scopeBlockers = shippingProductionVerifierScopeBlockers(status);
  if (scopeBlockers.length) throw new Error(scopeBlockers.join('; '));
  if (status.git.remoteProduction !== status.git.head || !status.git.clean) throw new Error('Verifier requires the clean deployed production commit');
  if (!evidenceEnvelopeValid(options.operator, repoRoot)) throw new Error('Operator evidence envelope is invalid');
  const live = verifyVercelProductionState(repoRoot, status.git.head, { stage: 'production_released' });
  if (live.blockers.length) throw new Error(live.blockers.join('; '));
  const { runtimePath } = loadDeliveryMutableBase({ repoRoot });
  const payload = await require('./shipping-workspace-verifier.js').verify({
    ...options, contractVersion: status.runtimeContractVersion, commit: status.git.head, deploymentId: live.snapshot.deployment.id,
    runtime: path.dirname(runtimePath)
  });
  const check = productionRuntimeEvidenceBlockers({ production_runtime: payload }, status.requiredProductionRuntimeEvidence, repoRoot, { commit: status.git.head, deploymentId: live.snapshot.deployment.id, runtimeContractVersion: status.runtimeContractVersion });
  if (check.length) throw new Error(check.join('; '));
  return recordDeliveryEvidence('production_runtime', payload, { repoRoot, liveShippingWorkspaceReceipt: LIVE_SHIPPING_WORKSPACE_RECEIPT });
}
function recordDeliveryEvidence(section, payload, options = {}) {
  const allowedSections = new Set(['code', 'preview', 'runtime', 'production_runtime', 'production', 'release_control']);
  if (allowedSections.has(section)) {
    if (
      section === 'production_runtime'
      && options.liveShippingWorkspaceReceipt !== LIVE_SHIPPING_WORKSPACE_RECEIPT
      && !(options.testOnlyControlledProductionRuntime === true && loadRegistry(options.repoRoot).registry.version === 'selftest')
    ) {
      throw new Error('production_runtime can only be written by the controlled live Production verifier; generic delivery-record JSON is forbidden');
    }
    const { data } = loadDeliveryMutableBase(options);
    if (section === 'release_control') {
      return writeDeliveryRuntime({
        releaseControl: { ...(data.releaseControl || {}), ...payload }
      }, { ...options, baseData: data });
    }
    return writeDeliveryRuntime({
      evidence: {
        ...(data.evidence || {}),
        [section]: { ...(data.evidence?.[section] || {}), ...payload }
      }
    }, { ...options, baseData: data });
  }

  if (section.startsWith('defect.')) {
    const defectId = section.slice('defect.'.length);
    if (!/^IN-\d{8}-\d+$/.test(defectId)) {
      throw new Error(`invalid defect id: ${defectId}`);
    }
    const { data } = loadDeliveryMutableBase(options);
    return writeDeliveryRuntime({
      defects: {
        ...(data.defects || {}),
        [defectId]: { ...(data.defects?.[defectId] || {}), ...payload }
      }
    }, { ...options, baseData: data });
  }

  throw new Error(`unknown delivery evidence section: ${section}`);
}

function transitionDeliveryState(stage, options = {}) {
  if (!DELIVERY_STATES.includes(stage)) {
    return { ok: false, stage, blockers: [`unknown delivery stage: ${stage}`] };
  }
  const status = getDeliveryStatus(options);
  const currentIndex = DELIVERY_STATES.indexOf(status.completionState);
  const nextIndex = DELIVERY_STATES.indexOf(stage);
  if (nextIndex < currentIndex) {
    return {
      ok: false,
      stage,
      blockers: [`delivery transition cannot move backwards: ${status.completionState} -> ${stage}`]
    };
  }
  if (nextIndex > currentIndex + 1) {
    return {
      ok: false,
      stage,
      blockers: [`delivery transition cannot skip states: ${status.completionState} -> ${stage}`]
    };
  }
  if (nextIndex === currentIndex) {
    const check = checkDeliveryStage(stage, { ...options, status });
    if (!check.ok) return check;
    return { ok: true, unchanged: true, stage, status: check.status };
  }
  const check = checkDeliveryStage(stage, {
    ...options,
    status,
    skipStateCheck: true,
    skipSealCheck: true
  });
  if (!check.ok) return check;
  const { data } = loadDeliveryMutableBase(options);
  const result = writeDeliveryRuntime(
    { completionState: stage },
    { ...options, baseData: data }
  );
  return {
    ok: true,
    unchanged: false,
    stage,
    runtimePath: result.runtimePath,
    status: getDeliveryStatus({ ...options, remoteSnapshot: status.remoteSnapshot })
  };
}

function isSchedulerPathAllowed(filePath, options = {}) {
  const { repoRoot, state } = loadSchedulerState(options);
  const relativePath = toRepoRelative(filePath, { repoRoot });
  const allowedPaths = state.active_task.allowed_paths || [];
  return {
    allowed: allowedPaths.some((allowedPath) => {
      const normalized = normalizeRelative(allowedPath);
      return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
    }),
    activeId: state.active_task.id,
    baselineStatus: state.product_baseline && state.product_baseline.status,
    relativePath
  };
}

function routeDemand(input) {
  if (Array.isArray(input.parts) && input.parts.length > 1) {
    return { route: 'split_required', activeSwitchAllowed: false };
  }
  if (input.userApprovedInterrupt === true) {
    return { route: 'approved_interrupt', activeSwitchAllowed: true };
  }
  if (input.invalidatesDirection === true || input.causesMajorRework === true || input.incident === true) {
    return { route: 'interrupt_candidate', activeSwitchAllowed: false };
  }
  if (input.kind === 'active_feedback' || input.blocksActiveAcceptance === true) {
    return { route: 'active_attachment', activeSwitchAllowed: false };
  }
  if (input.kind === 'question') {
    return { route: 'answer_or_research', activeSwitchAllowed: false };
  }
  return { route: 'inbox', activeSwitchAllowed: false };
}

function runSchedulerPressureTest() {
  const { state } = loadSchedulerState();
  const activeBefore = state.execution_queue.active.id;
  const cases = [
    { name: 'current implementation feedback', input: { kind: 'active_feedback' }, expected: 'active_attachment' },
    { name: 'ordinary favicon bug', input: { kind: 'bug' }, expected: 'inbox' },
    { name: 'Kiro reverse proxy lead', input: { kind: 'technical_lead' }, expected: 'inbox' },
    { name: 'organization cross-cutting request', input: { kind: 'cross_cutting_requirement' }, expected: 'inbox' },
    { name: 'direction invalidating evidence', input: { kind: 'product_decision', invalidatesDirection: true }, expected: 'interrupt_candidate' },
    { name: 'mixed request', input: { parts: ['bug', 'technical_lead', 'new_requirement'] }, expected: 'split_required' }
  ];
  const results = cases.map((testCase) => {
    const decision = routeDemand(testCase.input);
    return {
      name: testCase.name,
      expected: testCase.expected,
      actual: decision.route,
      activeSwitchAllowed: decision.activeSwitchAllowed,
      ok: decision.route === testCase.expected && decision.activeSwitchAllowed === false
    };
  });
  const activeAfter = loadSchedulerState().state.execution_queue.active.id;
  const ok = results.every((result) => result.ok) && activeBefore === activeAfter;
  return { ok, activeBefore, activeAfter, cases: results };
}

function runSchedulerCli(args) {
  const command = args[0] || 'scheduler-validate';
  if (command === 'scheduler-validate') {
    const result = validateSchedulerState();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 2;
  }

  if (command === 'scheduler-check') {
    const validation = validateSchedulerState();
    if (!validation.ok) {
      process.stderr.write(`SCHEDULER_INVALID: ${validation.errors.join('; ')}\n`);
      return 2;
    }
    const filePaths = args.slice(1);
    if (filePaths.length === 0) {
      process.stderr.write('scheduler-check requires at least one file path\n');
      return 2;
    }
    const results = filePaths.map((filePath) => isSchedulerPathAllowed(filePath));
    const blocked = results.filter((result) => !result.allowed);
    process.stdout.write(`${JSON.stringify({
      ok: blocked.length === 0,
      activeId: validation.activeId,
      baselineStatus: validation.baselineStatus,
      paths: results
    }, null, 2)}\n`);
    return blocked.length === 0 ? 0 : 2;
  }

  if (command === 'scheduler-pressure-test') {
    const result = runSchedulerPressureTest();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 2;
  }

  if (command === 'delivery-status') {
    process.stdout.write(`${JSON.stringify(getDeliveryStatus(), null, 2)}\n`);
    return 0;
  }

  if (command === 'delivery-check') {
    const stage = args[1] || 'executing';
    const result = checkDeliveryStage(stage);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 2;
  }

  if (command === 'delivery-record') {
    const section = args[1];
    const rawPayload = args.slice(2).join(' ');
    if (!section || !rawPayload) {
      process.stderr.write('delivery-record requires <code|preview|runtime|production|release_control|defect.IN-id> <json>; production_runtime is reserved for the controlled live verifier\n');
      return 2;
    }
    try {
      const payload = JSON.parse(rawPayload);
      const result = recordDeliveryEvidence(section, payload);
      process.stdout.write(`${JSON.stringify({ ok: true, section, ...result }, null, 2)}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`delivery-record failed: ${error.message}\n`);
      return 2;
    }
  }

  if (command === 'delivery-transition') {
    const stage = args[1] || '';
    const result = transitionDeliveryState(stage);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 2;
  }

  if (command === 'delivery-seal') {
    try {
      const result = sealDeliveryAttestation();
      process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`delivery-seal failed: ${error.message}\n`);
      return 2;
    }
  }

  process.stderr.write(`unknown project-registry command: ${command}\n`);
  return 2;
}

function runProjectRegistryCli(args) {
  const [command, ...rest] = args;

  if (!command || command === 'status') {
    printStatus();
    return 0;
  }

  if (command === 'run-hook') {
    const [hookId, ...hookArgs] = rest;
    if (!hookId) {
      process.stderr.write('Usage: project-registry.js run-hook <hook-id> [args...]\n');
      return 1;
    }
    return runHook(hookId, hookArgs);
  }

  const { config } = getHarnessRuntime();
  if (config.hook_commands && config.hook_commands[command]) {
    return runHook(command, rest);
  }

  return runSchedulerCli(args);
}

module.exports = {
  DEMAND_INBOX_RELATIVE_PATH,
  HARNESS_GATE_ID_PATTERN,
  HARNESS_GATE_PHASES,
  HARNESS_SETTINGS_RELATIVE_PATH,
  HARNESS_STATE_RELATIVE_PATH,
  REGISTRY_RELATIVE_PATH,
  REQUIRED_HARNESS_GATE_IDS,
  WORK_PACKAGE_ID_PATTERN,
  DELIVERY_STATES,
  DELIVERY_RUNTIME_FILE,
  DELIVERY_ATTESTATION_REF,
  REQUIRED_DEFECT_REPLAY_ACTIONS,
  SHIPPING_RUNTIME_ITEMS,
  SHIPPING_REPLAY_ACTIONS,
  SHIPPING_COLLABORATION_ACTIONS,
  SHIPPING_UI_ACTIONS,
  SHIPPING_UI_FLAGS,
  requiredReplayActions,
  shippingRuntimeEvidenceBlockers,
  shippingWorkspaceEvidenceBlockers,
  shippingProductionVerifierScopeBlockers,
  unresolvedBlockingDefects,
  VERCEL_PRODUCTION_CONTRACT,
  findRepoRoot,
  getDocumentEntry,
  getHarnessRuntime,
  isEnabled,
  isWithinDocument,
  loadRegistry,
  loadDemandInbox,
  normalizeRelative,
  pathExists,
  printStatus,
  isSchedulerPathAllowed,
  loadSchedulerState,
  getDeliveryStatus,
  loadDeliveryRuntime,
  recordDeliveryEvidence,
  verifyShippingWorkspaceProduction,
  resolveVercelDeploymentCommit,
  sealDeliveryAttestation,
  transitionDeliveryState,
  checkDeliveryStage,
  routeDemand,
  resolveEnabledDocumentPath,
  resolveDocumentPath,
  resolveRuntimePath,
  resolveHookCommand,
  runHook,
  runProjectRegistryCli,
  toRepoRelative,
  validateSchedulerState,
  runSchedulerPressureTest
};

if (require.main === module) {
  process.exitCode = runProjectRegistryCli(process.argv.slice(2));
}
