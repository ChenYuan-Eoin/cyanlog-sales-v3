#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { loadRegistry, VERCEL_PRODUCTION_CONTRACT } = require('./project-registry');

const PHASE_TO_GATE = {
  intake: 'HG0',
  research: 'HG1',
  contract_review: 'HG2',
  plan: 'HG2',
  execute: 'HG3',
  verify: 'HG4',
  evidence: 'HG4',
  approval: 'HG5',
  blocked: 'HG5',
  complete: null,
  idle: null
};

const AUTONOMY_LEVELS = {
  A0: {
    rank: 0,
    name: 'intake_read_only',
    canEdit: false,
    canRunLocalCommands: false,
    description: 'Goal intake, repository reads, and user clarification only.'
  },
  A1: {
    rank: 1,
    name: 'bounded_local_work',
    canEdit: true,
    canRunLocalCommands: true,
    description: 'Bounded local edits and local verification after contract approval.'
  },
  A2: {
    rank: 2,
    name: 'broad_local_work',
    canEdit: true,
    canRunLocalCommands: true,
    description: 'Broader local implementation and verification, still no external mutation.'
  },
  A3: {
    rank: 3,
    name: 'release_sensitive_work',
    canEdit: true,
    canRunLocalCommands: true,
    description: 'Release-adjacent work; production, billing, auth, data, and deploy actions still require approval.'
  }
};

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch']);
const ASK_TOOLS = new Set(['AskUserQuestion']);
const COMMAND_TOOLS = new Set(['Bash']);

const HIGH_RISK_PATTERNS = [
  { pattern: /(\s|^)rm\s+-[^;\n]*r[^;\n]*f\s+(\/|\*|\.|\.\.)/, reason: 'recursive forced deletion' },
  { pattern: /\bfind\b[^;\n]*\b-delete\b/, reason: 'bulk deletion' },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: 'destructive git reset' },
  { pattern: /\bgit\s+clean\s+-[^;\n]*f/, reason: 'destructive git clean' },
  { pattern: /\bgit\s+push(\s|$)/, reason: 'remote git mutation' },
  { pattern: /--force-with-lease|--force\b/, reason: 'forced mutation' },
  { pattern: /\bsudo\b/, reason: 'privileged command' },
  { pattern: /\bchmod\s+-R\s+777\b/, reason: 'broad permission weakening' },
  { pattern: /\b(vercel|netlify|wrangler|firebase|railway|render)\b[^;\n]*(--prod|deploy|publish)/, reason: 'deployment command' },
  { pattern: /\bvercel\s+(promote|rollback)\b/, reason: 'production alias mutation' },
  { pattern: /\bsupabase\b[^;\n]*(db\s+(push|reset)|migration\s+up|functions\s+deploy)/, reason: 'database or edge-function mutation' },
  { pattern: /\b(stripe|resend)\b[^;\n]*(create|delete|update|deploy|webhook)/, reason: 'billing or messaging provider mutation' },
  { pattern: /\b(drop\s+database|drop\s+schema|drop\s+table|truncate\s+table)\b/i, reason: 'destructive SQL' },
  { pattern: /\b(curl|wget|http)\b[^;\n]*\b(POST|PUT|PATCH|DELETE)\b/i, reason: 'external write request' }
];

// 门禁控制面命令：退出 HG0/HG2/HG5 的唯一途径是执行 harness-goal.js 的治理命令，
// 而这些阶段禁止 Bash；不放行就会把门禁自己锁死。这里只豁免该脚本的这一组子命令。
const HARNESS_CONTROL_COMMAND = /\bharness-goal\.js\b\s+(status|template|approve|revise|evidence|checkpoint|audit|phase|complete|clear)\b/;

const MATRIX_STATUS = {
  PASS: 'pass',
  INFO: 'info',
  BLOCK: 'block',
  APPROVAL: 'requires_approval'
};

const COMPLETION_PASS_STATUSES = new Set(['pass', 'passed', 'done', 'complete', 'completed']);

const DEFAULT_REQUIRED_RESEARCH_CHECKS = [
  {
    id: 'repo-pattern-scan',
    description: 'inspect existing codebase, governance docs, helpers, scripts, and local patterns before implementation'
  },
  {
    id: 'reuse-or-library-scan',
    description: 'look for existing project utilities, proven libraries, or platform-native features before writing new logic'
  },
  {
    id: 'best-practice-check',
    description: 'use authoritative local docs or primary external docs when technical facts, APIs, or standards may be stale'
  },
  {
    id: 'user-intent-boundary-check',
    description: 'ask the user or stop when intent, authority, scope, or risk cannot be inferred safely'
  }
];

function repoRootFromRegistry() {
  return loadRegistry().repoRoot;
}

function harnessRuntimeDir(repoRoot) {
  if (process.env.PRICE_V3_HARNESS_RUNTIME_DIR) {
    return path.resolve(process.env.PRICE_V3_HARNESS_RUNTIME_DIR);
  }
  const result = spawnSync('git', [
    'rev-parse',
    '--path-format=absolute',
    '--git-path',
    'codex-runtime/harness'
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || 'cannot resolve Harness runtime directory').trim());
  }
  return result.stdout.trim();
}

function paths(repoRoot = repoRootFromRegistry()) {
  const runtimeDir = harnessRuntimeDir(repoRoot);
  return {
    repoRoot,
    runtimeDir,
    settingsPath: path.join(repoRoot, 'governance/runtime-config-AI运行配置/config-配置文件/settings-claude运行配置.json'),
    registryPath: path.join(repoRoot, 'governance/runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json'),
    documentRulesPath: path.join(repoRoot, 'docs-governance/maintenance-config-维护配置/config-配置文件/document-maintenance-rules-文档维护规则.json'),
    statePath: path.join(runtimeDir, 'harness-state.json'),
    contractPath: path.join(runtimeDir, 'goal-contract.json'),
    evidenceLedgerPath: path.join(runtimeDir, 'evidence-ledger.jsonl')
  };
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeAutonomyLevel(level) {
  const normalized = String(level || 'A0').toUpperCase();
  if (!AUTONOMY_LEVELS[normalized]) {
    throw new Error(`Unknown autonomy level: ${level}`);
  }
  return normalized;
}

function parseCsv(value) {
  if (!value) {
    return [];
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function hashText(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''), 'utf8')
    .digest('hex');
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function autonomyAllowedItems(level) {
  const normalized = normalizeAutonomyLevel(level);
  const autonomy = AUTONOMY_LEVELS[normalized];
  return [
    'read repository files',
    'inspect existing scripts and configuration',
    'summarize risks and unknowns',
    ...(autonomy.canRunLocalCommands ? ['run local verification commands'] : []),
    ...(autonomy.canEdit ? ['edit scoped workspace files after contract approval'] : [])
  ];
}

function makeGoalContract(goalText, options = {}) {
  const now = nowIso();
  const level = normalizeAutonomyLevel(options.level || options.autonomy || 'A0');
  const autonomy = AUTONOMY_LEVELS[level];
  const successCriteria = parseCsv(options.success);

  return {
    version: '1.0',
    id: `goal-${now.replace(/[-:.TZ]/g, '').slice(0, 14)}`,
    workPackageId: options.workPackageId || null,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    sourceGoal: goalText,
    objective: goalText,
    successCriteria: successCriteria.length ? successCriteria : [
      'goal contract reviewed before execution',
      'unknowns classified as researchable, user-intent, safe assumptions, or blocked',
      'bounded execution evidence collected',
      'completion audit passes before complete'
    ],
    nonGoals: parseCsv(options.nonGoals),
    researchPlan: {
      researchable: parseCsv(options.researchable),
      askUser: parseCsv(options.askUser),
      requiredChecks: parseCsv(options.requiredChecks).length
        ? parseCsv(options.requiredChecks).map((id) => ({ id, description: id }))
        : DEFAULT_REQUIRED_RESEARCH_CHECKS,
      blocked: [],
      safeAssumptions: [],
      researchFindings: [],
      userAnswers: []
    },
    sovereignty: {
      originalGoalHash: hashText(goalText),
      currentGoalHash: hashText(goalText),
      revisionPolicy: 'user-approved-only',
      agentMayRedefineGoal: false
    },
    autonomyBudget: {
      level,
      name: autonomy.name,
      allowed: autonomyAllowedItems(level),
      requiresApproval: [
        'source edits before contract approval',
        'database/auth/billing changes',
        'deployments and external writes',
        'destructive filesystem or git operations',
        'production data access',
        'new dependencies or package-manager lockfile churn'
      ],
      forbiddenAutonomous: [
        'delete broad directory trees',
        'force push or rewrite git history',
        'deploy to production',
        'mutate remote databases',
        'change billing/auth providers',
        'read secrets beyond explicitly requested config'
      ]
    },
    boundaries: {
      allowedScopes: parseCsv(options.scopes),
      forbiddenScopes: parseCsv(options.forbiddenScopes),
      highRiskActions: HIGH_RISK_PATTERNS.map((item) => item.reason)
    },
    phase: {
      current: 'intake',
      gate: PHASE_TO_GATE.intake,
      history: [
        { at: now, phase: 'intake', gate: PHASE_TO_GATE.intake, reason: 'goal started' }
      ]
    },
    checkpoints: [
      { name: 'intake contract reviewed', status: 'pending' },
      { name: 'research findings summarized', status: 'pending' },
      { name: 'execution plan approved or bounded', status: 'pending' },
      { name: 'verification evidence collected', status: 'pending' }
    ],
    stopConditions: [
      'required user intent is unknown',
      'requested action crosses forbidden scope',
      'high-risk action is needed',
      'verification cannot be run or is failing repeatedly',
      'implementation requires production credentials or deployment'
    ],
    evidence: {
      required: [
        'changed files summary',
        'validation commands and results',
        'unverified items',
        'risk and rollback notes'
      ],
      collected: []
    }
  };
}

function ensureContractDefaults(contract) {
  if (!contract) {
    return contract;
  }
  contract.sourceGoal = contract.sourceGoal || contract.objective || '';
  contract.successCriteria = contract.successCriteria?.length ? contract.successCriteria : [
    'goal contract reviewed before execution',
    'unknowns classified as researchable, user-intent, safe assumptions, or blocked',
    'bounded execution evidence collected',
    'completion audit passes before complete'
  ];
  contract.researchPlan = contract.researchPlan || {};
  contract.researchPlan.researchable = contract.researchPlan.researchable || [];
  contract.researchPlan.askUser = contract.researchPlan.askUser || [];
  contract.researchPlan.requiredChecks = contract.researchPlan.requiredChecks || DEFAULT_REQUIRED_RESEARCH_CHECKS;
  contract.researchPlan.blocked = contract.researchPlan.blocked || [];
  contract.researchPlan.safeAssumptions = contract.researchPlan.safeAssumptions || [];
  contract.researchPlan.researchFindings = contract.researchPlan.researchFindings || [];
  contract.researchPlan.userAnswers = contract.researchPlan.userAnswers || [];
  contract.sovereignty = contract.sovereignty || {
    originalGoalHash: hashText(contract.sourceGoal),
    currentGoalHash: hashText(contract.sourceGoal),
    revisionPolicy: 'user-approved-only',
    agentMayRedefineGoal: false
  };
  contract.revisions = contract.revisions || [];
  contract.revisions.forEach((revision, index) => {
    if (!revision.newObjectiveHash) {
      revision.newObjectiveHash = contract.revisions[index + 1]?.previousObjectiveHash || hashText(contract.sourceGoal);
    }
  });
  contract.sovereignty.currentGoalHash = contract.sovereignty.currentGoalHash
    || (contract.revisions.length ? contract.revisions[contract.revisions.length - 1].newObjectiveHash : contract.sovereignty.originalGoalHash);
  contract.evidence = contract.evidence || { required: [], collected: [] };
  contract.evidence.required = contract.evidence.required?.length ? contract.evidence.required : [
    'changed files summary',
    'validation commands and results',
    'unverified items',
    'risk and rollback notes'
  ];
  contract.evidence.collected = contract.evidence.collected || [];
  contract.checkpoints = contract.checkpoints?.length ? contract.checkpoints : [
    { name: 'intake contract reviewed', status: 'pending' },
    { name: 'research findings summarized', status: 'pending' },
    { name: 'execution plan approved or bounded', status: 'pending' },
    { name: 'verification evidence collected', status: 'pending' }
  ];
  return contract;
}

function loadSettings(repoRoot) {
  return readJson(paths(repoRoot).settingsPath, {});
}

function loadState(repoRoot) {
  return readJson(paths(repoRoot).statePath, {
    version: '1.0',
    status: 'permissive',
    mode: 'permissive',
    phase: 'idle',
    activeGates: []
  });
}

function saveState(repoRoot, state) {
  writeJson(paths(repoRoot).statePath, state);
}

function loadContract(repoRoot) {
  return ensureContractDefaults(readJson(paths(repoRoot).contractPath, null));
}

function saveContract(repoRoot, contract) {
  ensureContractDefaults(contract);
  contract.updatedAt = nowIso();
  writeJson(paths(repoRoot).contractPath, contract);
}

function validateContract(contract) {
  const errors = [];
  if (!contract) {
    errors.push('goal contract is missing');
    return errors;
  }
  if (!contract.objective || !String(contract.objective).trim()) {
    errors.push('objective is required');
  }
  if (!contract.sourceGoal || !String(contract.sourceGoal).trim()) {
    errors.push('sourceGoal is required');
  }
  if (!contract.successCriteria || !contract.successCriteria.length) {
    errors.push('successCriteria are required');
  }
  if (contract.workPackageId && !/^WP\d{2}$/.test(contract.workPackageId)) {
    errors.push(`workPackageId must be WP00-WP99: ${contract.workPackageId}`);
  }
  try {
    normalizeAutonomyLevel(contract.autonomyBudget?.level);
  } catch (error) {
    errors.push(error.message);
  }
  if (!contract.stopConditions || !contract.stopConditions.length) {
    errors.push('stopConditions are required');
  }
  if (!contract.evidence?.required?.length) {
    errors.push('evidence.required is required');
  }
  return errors;
}

function isPassStatus(status) {
  return COMPLETION_PASS_STATUSES.has(String(status || '').toLowerCase());
}

function evidenceEntries(contract) {
  return contract?.evidence?.collected || [];
}

function evidenceSatisfies(entry, target) {
  const normalizedTarget = normalizeText(target);
  if (!normalizedTarget) {
    return false;
  }
  const satisfies = Array.isArray(entry?.satisfies)
    ? entry.satisfies
    : parseCsv(entry?.satisfies);
  if (satisfies.some((item) => normalizeText(item) === normalizedTarget || item === '*')) {
    return true;
  }
  const haystack = normalizeText([
    entry?.type,
    entry?.summary,
    entry?.detail
  ].filter(Boolean).join(' '));
  return haystack.includes(normalizedTarget);
}

function hasPassingEvidence(contract, target) {
  return evidenceEntries(contract).some((entry) => isPassStatus(entry.status) && evidenceSatisfies(entry, target));
}

function evaluateIntakeReadiness(contract) {
  const findings = [];
  const researchPlan = contract?.researchPlan || {};

  if (!contract?.successCriteria?.length) {
    findings.push({
      level: 'block',
      name: 'success criteria',
      detail: 'successCriteria must be defined before execution'
    });
  }

  const level = normalizeAutonomyLevel(contract?.autonomyBudget?.level || 'A0');
  if (AUTONOMY_LEVELS[level].canEdit && !(contract?.boundaries?.allowedScopes || []).length) {
    findings.push({
      level: 'block',
      name: 'allowed scopes',
      detail: 'allowedScopes must be defined before autonomous edits'
    });
  }

  for (const item of researchPlan.blocked || []) {
    findings.push({
      level: 'block',
      name: 'blocked unknown',
      detail: String(item)
    });
  }

  for (const item of researchPlan.askUser || []) {
    if (!hasPassingEvidence(contract, `user-answer:${item}`) && !hasPassingEvidence(contract, item)) {
      findings.push({
        level: 'block',
        name: 'user intent question',
        detail: `requires user answer before execution: ${item}`
      });
    }
  }

  for (const item of researchPlan.researchable || []) {
    if (!hasPassingEvidence(contract, `research:${item}`) && !hasPassingEvidence(contract, item)) {
      findings.push({
        level: 'block',
        name: 'researchable unknown',
        detail: `requires research evidence before execution: ${item}`
      });
    }
  }

  for (const item of researchPlan.requiredChecks || []) {
    const id = typeof item === 'string' ? item : item.id;
    if (!id) {
      findings.push({
        level: 'block',
        name: 'required research check',
        detail: 'required research check is missing id'
      });
      continue;
    }
    if (!hasPassingEvidence(contract, `research-check:${id}`) && !hasPassingEvidence(contract, id)) {
      findings.push({
        level: 'block',
        name: 'required research check',
        detail: `requires evidence before execution: research-check:${id}`
      });
    }
  }

  return findings;
}

function canEnterPhase(contract, phase) {
  if (!Object.prototype.hasOwnProperty.call(PHASE_TO_GATE, phase)) {
    return { ok: false, reason: `unknown phase: ${phase}` };
  }
  if (phase === 'idle') {
    return { ok: true };
  }
  if (!contract) {
    return { ok: false, reason: 'goal contract is required' };
  }
  const contractErrors = validateContract(contract);
  if (contractErrors.length) {
    return { ok: false, reason: contractErrors.join('; ') };
  }
  if (phase === 'execute') {
    const level = normalizeAutonomyLevel(contract.autonomyBudget?.level);
    if (!AUTONOMY_LEVELS[level].canEdit) {
      return { ok: false, reason: `autonomy ${level} does not allow edits` };
    }
    if (!['approved', 'active'].includes(contract.status)) {
      return { ok: false, reason: 'contract must be approved before execute phase' };
    }
    const blockers = evaluateIntakeReadiness(contract).filter((item) => item.level === 'block');
    if (blockers.length) {
      return { ok: false, reason: blockers.map((item) => `${item.name}: ${item.detail}`).join('; ') };
    }
  }
  return { ok: true };
}

function setPhase(repoRoot, phase, reason = 'manual phase switch', options = {}) {
  if (phase === 'complete' && !options.skipCompletionAudit) {
    const audit = completionAudit(repoRoot);
    if (!audit.ok) {
      throw new Error(`completion audit failed: ${audit.blockers.join('; ')}`);
    }
  }
  const gate = PHASE_TO_GATE[phase];
  const contract = loadContract(repoRoot);
  const allowed = canEnterPhase(contract, phase);
  if (!allowed.ok) {
    throw new Error(allowed.reason);
  }

  const state = loadState(repoRoot);
  state.activeHooks = ['UserPromptSubmit', 'PreToolUse', 'Stop'];
  state.mode = gate ? 'enforcing' : 'permissive';
  state.status = state.mode;
  state.phase = phase;
  state.activeGates = gate ? [gate] : [];
  state.longTask = {
    enabled: Boolean(gate),
    contractPath: gate ? path.relative(repoRoot, paths(repoRoot).contractPath) : null
  };
  state.currentGoal = contract && gate ? {
    id: contract.id,
    workPackageId: contract.workPackageId || null,
    objective: contract.objective,
    contractPath: path.relative(repoRoot, paths(repoRoot).contractPath),
    status: contract.status,
    autonomy: contract.autonomyBudget?.level || 'A0'
  } : null;
  state.lastActivity = nowIso();
  saveState(repoRoot, state);

  if (contract) {
    contract.phase = contract.phase || { history: [] };
    contract.phase.current = phase;
    contract.phase.gate = gate;
    contract.phase.history = contract.phase.history || [];
    contract.phase.history.push({ at: state.lastActivity, phase, gate, reason });
    saveContract(repoRoot, contract);
  }

  return { state, contract, gate };
}

function startGoal(repoRoot, goalText, options = {}) {
  if (!goalText || !goalText.trim()) {
    throw new Error('goal text is required');
  }
  const contract = makeGoalContract(goalText.trim(), options);
  saveContract(repoRoot, contract);
  const { state } = setPhase(repoRoot, 'intake', 'goal started');
  return { state, contract };
}

function reviseContract(repoRoot, goalText, options = {}) {
  const contract = loadContract(repoRoot);
  if (!contract) throw new Error('goal contract is required');
  const reason = String(options.reason || '').trim();
  const authority = String(options.authority || '').trim();
  const revisedBy = String(options.by || '').trim();
  if (!reason) throw new Error('goal revision reason is required');
  if (!authority) throw new Error('goal revision authority is required');
  if (!revisedBy) throw new Error('goal revision actor is required');

  const now = nowIso();
  contract.revisions = contract.revisions || [];
  contract.revisions.push({
    at: now,
    by: revisedBy,
    authority,
    reason,
    previousObjective: contract.objective,
    previousObjectiveHash: hashText(contract.objective),
    previousSuccessCriteria: [...(contract.successCriteria || [])],
    previousNonGoals: [...(contract.nonGoals || [])],
    previousCheckpoints: (contract.checkpoints || []).map((checkpoint) => ({ ...checkpoint })),
    previousStatus: contract.status
  });

  if (String(goalText || '').trim()) {
    contract.objective = String(goalText).trim();
    contract.sourceGoal = contract.objective;
  }
  for (const [optionKey, contractKey] of [
    ['success', 'successCriteria'],
    ['nonGoals', 'nonGoals']
  ]) {
    if (options[optionKey] !== undefined) contract[contractKey] = parseCsv(options[optionKey]);
  }
  if (options.scopes !== undefined) contract.boundaries.allowedScopes = parseCsv(options.scopes);
  if (options.forbiddenScopes !== undefined) contract.boundaries.forbiddenScopes = parseCsv(options.forbiddenScopes);
  if (options.researchable !== undefined) contract.researchPlan.researchable = parseCsv(options.researchable);
  if (options.askUser !== undefined) contract.researchPlan.askUser = parseCsv(options.askUser);
  const latestRevision = contract.revisions[contract.revisions.length - 1];
  latestRevision.newObjectiveHash = hashText(contract.sourceGoal);
  contract.sovereignty.currentGoalHash = latestRevision.newObjectiveHash;
  contract.checkpoints = (contract.checkpoints || []).map((checkpoint) => ({
    ...checkpoint,
    status: 'pending',
    detail: `reset by goal revision: ${reason}`,
    updatedAt: now
  }));

  contract.status = 'draft';
  delete contract.approvedAt;
  delete contract.approvedBy;
  contract.phase = contract.phase || { history: [] };
  contract.phase.current = 'contract_review';
  contract.phase.gate = PHASE_TO_GATE.contract_review;
  contract.phase.history = contract.phase.history || [];
  contract.phase.history.push({
    at: now,
    phase: 'contract_review',
    gate: PHASE_TO_GATE.contract_review,
    reason: `goal revised: ${reason}`,
    authority
  });
  saveContract(repoRoot, contract);

  const state = loadState(repoRoot);
  state.mode = 'enforcing';
  state.status = 'enforcing';
  state.phase = 'contract_review';
  state.activeGates = [PHASE_TO_GATE.contract_review];
  state.activeHooks = ['UserPromptSubmit', 'PreToolUse', 'Stop'];
  state.longTask = {
    enabled: true,
    contractPath: path.relative(repoRoot, paths(repoRoot).contractPath)
  };
  state.currentGoal = {
    id: contract.id,
    workPackageId: contract.workPackageId || null,
    objective: contract.objective,
    contractPath: path.relative(repoRoot, paths(repoRoot).contractPath),
    status: contract.status,
    autonomy: contract.autonomyBudget?.level || 'A0'
  };
  state.lastActivity = now;
  saveState(repoRoot, state);
  return contract;
}

function approveContract(repoRoot, options = {}) {
  const contract = loadContract(repoRoot);
  if (!contract) {
    throw new Error('goal contract is required');
  }
  const errors = validateContract(contract);
  if (errors.length) {
    throw new Error(errors.join('; '));
  }
  if (options.level) {
    const level = normalizeAutonomyLevel(options.level);
    contract.autonomyBudget.level = level;
    contract.autonomyBudget.name = AUTONOMY_LEVELS[level].name;
    contract.autonomyBudget.allowed = autonomyAllowedItems(level);
  }
  contract.status = 'approved';
  contract.approvedAt = nowIso();
  contract.approvedBy = options.by || 'user';
  const latestRevision = contract.revisions?.[contract.revisions.length - 1];
  if (latestRevision && !latestRevision.approvedAt) {
    latestRevision.approvedAt = contract.approvedAt;
    latestRevision.approvedBy = contract.approvedBy;
  }
  saveContract(repoRoot, contract);
  const state = loadState(repoRoot);
  if (state.currentGoal) {
    state.currentGoal.status = contract.status;
    state.currentGoal.autonomy = contract.autonomyBudget.level;
    state.lastActivity = nowIso();
    saveState(repoRoot, state);
  }
  return contract;
}

function clearGoal(repoRoot) {
  const state = loadState(repoRoot);
  state.mode = 'permissive';
  state.status = 'permissive';
  state.phase = 'idle';
  state.activeGates = [];
  state.longTask = { enabled: false, contractPath: null };
  state.currentGoal = null;
  state.lastActivity = nowIso();
  saveState(repoRoot, state);
  const { contractPath } = paths(repoRoot);
  if (fs.existsSync(contractPath)) {
    fs.unlinkSync(contractPath);
  }
  return state;
}

function checkpointStatusOk(status) {
  return isPassStatus(status);
}

function updateCheckpoint(repoRoot, options = {}) {
  const contract = loadContract(repoRoot);
  if (!contract) {
    throw new Error('goal contract is required');
  }
  const name = options.name || options.id;
  if (!name) {
    throw new Error('checkpoint name is required');
  }
  contract.checkpoints = contract.checkpoints || [];
  let checkpoint = contract.checkpoints.find((item) => item.id === name || item.name === name);
  if (!checkpoint) {
    checkpoint = { name, status: 'pending' };
    contract.checkpoints.push(checkpoint);
  }
  checkpoint.status = options.status || checkpoint.status || 'pending';
  checkpoint.detail = options.detail || checkpoint.detail || '';
  checkpoint.updatedAt = nowIso();
  saveContract(repoRoot, contract);
  return checkpoint;
}

function activeGate(state) {
  if (!state || state.mode === 'permissive' || !state.mode) {
    return null;
  }
  return (state.activeGates || [])[0] || '__missing__';
}

function normalizeToolName(name) {
  const raw = String(name || '');
  if (!raw) {
    return '';
  }
  // Exact read-only connectors; do not classify arbitrary MCP tools by suffix.
  if (/^mcp__codex_apps__vercel__(get_deployment|get_project|list_deployments|get_project_domain|list_project_domains)$/.test(raw)
    || /^mcp__codex_app__(list_artifacts|get_worktree_creation_status)$/.test(raw)) return 'Read';
  // This tool creates a managed local checkout for the current repository only.
  if (raw === 'mcp__codex_app__create_worktree') return 'Edit';
  // Codex 与 Claude 的工具名不同，这里统一归一到 gate 表使用的名称。
  const lastDot = raw.lastIndexOf('.');
  const dotTail = lastDot === -1 ? raw : raw.slice(lastDot + 1);
  const tail = dotTail.includes('__') ? dotTail.split('__').pop() : dotTail;
  const is = (...names) => names.includes(raw) || names.includes(dotTail) || names.includes(tail);
  if (is('apply_patch', 'edit_file', 'str_replace_editor')) {
    return 'Edit';
  }
  if (is('write_file', 'create_file')) {
    return 'Write';
  }
  if (is('exec_command', 'write_stdin', 'Bash', 'Shell')) {
    return 'Bash';
  }
  if (is('request_user_input', 'request_user_input_async', 'AskUserQuestion')) {
    return 'AskUserQuestion';
  }
  if (is('read_file', 'list_dir', 'list_files', 'find_files', 'view_image', 'tool_search')) {
    return 'Read';
  }
  if (is('read_mcp_resource', 'list_mcp_resources')) {
    return 'Read';
  }
  if (is('grep', 'grep_files', 'search_files', 'search_content')) {
    return 'Grep';
  }
  if (is('glob')) {
    return 'Glob';
  }
  return raw;
}

function detectCommandRisk(command = '') {
  if (isPlainDocumentRead(command)) return '';
  for (const item of HIGH_RISK_PATTERNS) {
    if (item.pattern.test(command)) {
      return item.reason;
    }
  }
  return '';
}

// Only a literal document read is exempt. Shell expansion, redirection, pipes
// and command composition deliberately fall through to the normal checks.
function isPlainDocumentRead(command) {
  return /^cat[ \t]+(?:\/[A-Za-z0-9_./-]+\.md)(?:[ \t]+\/[A-Za-z0-9_./-]+\.md)*[ \t]*$/.test(command);
}

// Supplement existing gates with a single-use grant, never a blanket bypass.
// Authority is recorded user evidence, not cryptographic human authentication.
function actionWorkspace(repoRoot, cwd) {
  const root = fs.realpathSync(repoRoot), directory = fs.realpathSync(cwd);
  if (directory === root || directory.startsWith(`${root}${path.sep}`)) return root;
  const gitPath = (at, argument) => {
    const result = spawnSync('git', ['rev-parse', argument], { cwd: at, encoding: 'utf8' });
    if (result.status !== 0) throw new Error('action workspace is not a repository');
    return fs.realpathSync(path.resolve(at, result.stdout.trim()));
  };
  const worktree = gitPath(directory, '--show-toplevel');
  if (gitPath(root, '--git-common-dir') !== gitPath(worktree, '--git-common-dir')) throw new Error('action workspace belongs to another repository');
  const parentGoal = loadContract(root), worktreeGoal = loadContract(worktree);
  if (parentGoal?.status !== 'approved' || worktreeGoal?.status !== 'approved' || parentGoal.workPackageId !== worktreeGoal.workPackageId) throw new Error('action workspace has no matching approved work package');
  return worktree;
}

function actionBinding(repoRoot, command, cwd) {
  if (typeof command !== 'string' || /[\n\r;$`|&<>\\"']/.test(command)) throw new Error('one literal command required');
  repoRoot = actionWorkspace(repoRoot, cwd);
  const directory = fs.realpathSync(cwd);
  const root = fs.realpathSync(repoRoot);
  if (directory !== root && !directory.startsWith(`${root}${path.sep}`)) throw new Error('cwd outside workspace');
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error('cannot bind approval to git state');
    return result.stdout.trim();
  };
  let target, environment, action, deploymentId = null, refObject = null;
  const previewDeploy = /^(?:\/[A-Za-z0-9_./-]+\/)?vercel deploy --target preview --scope [A-Za-z0-9_-]+(?: --yes)?$/.test(command);
  const productionDeploy = /^(?:\/[A-Za-z0-9_./-]+\/)?vercel deploy --prod --skip-domain --scope [A-Za-z0-9_-]+(?: --yes)?$/.test(command);
  const productionPromote = /^(?:\/[A-Za-z0-9_./-]+\/)?vercel promote dpl_[A-Za-z0-9]+ --scope [A-Za-z0-9_-]+(?: --yes)?$/.test(command);
  if (previewDeploy || productionDeploy || productionPromote) {
    const linked = readJson(path.join(directory, '.vercel/project.json'));
    const scope = command.match(/--scope ([A-Za-z0-9_-]+)/)[1];
    if (!linked?.projectId || linked.orgId !== scope) throw new Error('preview project/scope binding missing');
    if ((process.env.VERCEL_PROJECT_ID && process.env.VERCEL_PROJECT_ID !== linked.projectId) ||
        (process.env.VERCEL_ORG_ID && process.env.VERCEL_ORG_ID !== linked.orgId)) throw new Error('environment overrides preview target');
    target = `${linked.orgId}/${linked.projectId}`;
    environment = previewDeploy ? 'preview' : 'production';
    action = previewDeploy ? 'preview_deploy' : productionDeploy ? 'staged_production_deploy' : 'production_promote';
    if (productionPromote) deploymentId = command.match(/ promote (dpl_[A-Za-z0-9]+) /)[1];
  } else if (/^git push origin (?:(?:HEAD|[a-f0-9]{40}):refs\/heads\/(?:main|production|codex\/[a-z0-9-]+)|refs\/notes\/price-v3-delivery)$/.test(command)) {
    if (!['https://github.com/ChenYuan-Eoin/cyanlog-sales-v3.git', 'git@github.com:ChenYuan-Eoin/cyanlog-sales-v3.git'].includes(git(['remote', 'get-url', '--push', 'origin']))) throw new Error('unexpected release git remote');
    if (command.endsWith('refs/notes/price-v3-delivery')) refObject = git(['rev-parse', 'refs/notes/price-v3-delivery']);
    else if (git(['rev-parse', command.split(' ')[3].split(':')[0]]) !== git(['rev-parse', 'HEAD'])) throw new Error('only exact HEAD may be pushed');
    target = `${VERCEL_PRODUCTION_CONTRACT.teamId}/${VERCEL_PRODUCTION_CONTRACT.projectId}`;
    environment = 'production';
    action = 'release_git_push';
  } else if (/^(?:\/[A-Za-z0-9_./-]+\/)?supabase db push --db-url \S+$/.test(command)) {
    const url = new URL(command.split(' --db-url ')[1]);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname)) throw new Error('explicit isolated database host required');
    target = url.hostname;
    environment = 'sandbox';
    action = 'sandbox_database_push';
  } else throw new Error('unsupported approval action');
  if (git(['status', '--porcelain']).length) throw new Error('approval requires clean committed workspace');
  const contract = loadContract(repoRoot);
  if (contract?.status !== 'approved') throw new Error('approved goal required');
  return { commandHash: hashText(command), cwd: directory, workspace: root, head: git(['rev-parse', 'HEAD']),
    goalHash: hashText(JSON.stringify([contract.id, contract.objective, contract.boundaries, contract.revisions])), target, environment, action, deploymentId, refObject };
}

function actionAuthority(repoRoot, authority, binding) {
  repoRoot = binding.workspace;
  const inbox = fs.readFileSync(path.join(repoRoot, 'governance/runtime-state/demand-inbox.jsonl'), 'utf8');
  const entry = inbox.split('\n').filter(Boolean).map((line) => JSON.parse(line)).find((item) => item.id === authority);
  const allowed = entry?.action_approval;
  if (entry?.state !== 'user_authorized' || allowed?.by !== 'user' ||
      allowed.target !== binding.target || allowed.environment !== binding.environment ||
      allowed.commandHash !== binding.commandHash || allowed.cwd !== binding.cwd) throw new Error('matching explicit user action authority required');
  if (binding.environment === 'production') {
    const state = readJson(path.join(repoRoot, 'governance/runtime-state/active-task.json'));
    const contract = state?.active_task?.delivery_contract;
    const release = contract?.production_release_authorization;
    const record = inbox.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(item => item.id === release?.final_release_approval_id);
    if (release?.status !== 'approved_code_only' || contract.final_acceptance?.production_database_mode !== 'read_only'
      || record?.type !== 'final_production_release_authorization' || record.state !== 'approved' || record.source !== 'user_explicit'
      || record.code_release_authorized !== true || record.production_database_write_authorized !== false
      || record.scope !== release.final_scope || record.authorized_commit_binding !== 'delivery_attestation_current_head'
      || allowed.releaseAuthority !== record.id || binding.target !== `${release.vercel_team_id}/${release.vercel_project_id}`) {
      throw new Error('matching code-only Production release authority required');
    }
    if (binding.action === 'production_promote') {
      if (allowed.deploymentId !== binding.deploymentId || allowed.deploymentCommit !== binding.head
        || allowed.deploymentProjectId !== release.vercel_project_id || allowed.deploymentTarget !== 'production'
        || allowed.deploymentState !== 'READY') throw new Error('exact READY Production deployment binding required');
    } else if (!['staged_production_deploy', 'release_git_push'].includes(binding.action) || allowed.commandKind !== binding.action) {
      throw new Error('Production action must be staged deploy or exact deployment promotion');
    }
  }
}

function approveAction(repoRoot, request) {
  const binding = actionBinding(repoRoot, request.command, request.cwd);
  repoRoot = binding.workspace;
  actionAuthority(repoRoot, request.authority, binding);
  const expires = Date.parse(request.expiresAt);
  if (!Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 3600000) throw new Error('approval expiry must be within one hour');
  const approval = { ...binding, authority: request.authority, expiresAt: request.expiresAt, id: crypto.randomUUID() };
  const file = path.join(paths(repoRoot).runtimeDir, 'action-approvals', `${binding.commandHash}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(approval), { flag: 'wx', mode: 0o600 });
  appendJsonl(paths(repoRoot).evidenceLedgerPath, { type: 'action-approved', at: nowIso(), ...approval });
  return approval;
}

function consumeActionApproval(repoRoot, command, payload) {
  try {
    const input = payload.tool_input || payload.input || payload.arguments || payload;
    const binding = actionBinding(repoRoot, command, input.workdir || input.cwd || repoRoot);
    repoRoot = binding.workspace;
    const file = path.join(paths(repoRoot).runtimeDir, 'action-approvals', `${binding.commandHash}.json`);
    const approval = readJson(file);
    if (!approval || !(Date.parse(approval.expiresAt) > Date.now()) ||
        Object.keys(binding).some((key) => approval[key] !== binding[key])) return null;
    actionAuthority(repoRoot, approval.authority, binding);
    // Retained exclusive marker prevents concurrent consumption and replay.
    // This records allowance, not successful external execution.
    fs.writeFileSync(`${file}.consumed`, nowIso(), { flag: 'wx', mode: 0o600 });
    appendJsonl(paths(repoRoot).evidenceLedgerPath, { type: 'action-allowed-once', id: approval.id, at: nowIso() });
    return approval.id;
  } catch {
    return null;
  }
}

function commandTextFromPayload(payload = {}) {
  const candidates = [
    payload.tool_input?.cmd,
    payload.tool_input?.command,
    payload.tool_input?.chars,
    payload.tool_input?.stdin,
    payload.input?.cmd,
    payload.input?.command,
    payload.input?.chars,
    payload.arguments?.cmd,
    payload.arguments?.command,
    payload.arguments?.chars,
    payload.cmd,
    payload.command
  ];
  return String(candidates.find((value) => value) || '');
}

function toolCategory(toolName) {
  if (READ_TOOLS.has(toolName)) return 'read';
  if (EDIT_TOOLS.has(toolName)) return 'edit';
  if (COMMAND_TOOLS.has(toolName)) return 'command';
  if (ASK_TOOLS.has(toolName)) return 'ask';
  return 'other';
}

function payloadFilePath(payload = {}) {
  return payload.tool_input?.file_path ||
    payload.tool_input?.path ||
    payload.input?.file_path ||
    payload.input?.path ||
    payload.arguments?.file_path ||
    payload.arguments?.path ||
    payload.file_path ||
    payload.path ||
    '';
}

function normalizeRepoRelative(repoRoot, filePath) {
  if (!filePath) {
    return '';
  }
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  return path.relative(repoRoot, absolute).replace(/\\/g, '/');
}

function isHarnessRuntimeStatePath(repoRoot, filePath) {
  if (!filePath) {
    return false;
  }
  const absolute = path.resolve(path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath));
  const runtimePaths = paths(repoRoot);
  return [
    runtimePaths.statePath,
    runtimePaths.contractPath,
    runtimePaths.evidenceLedgerPath
  ].some((runtimePath) => path.resolve(runtimePath) === absolute);
}

function normalizedScopes(contract) {
  // 历史 contract 可能把多个 scope 写成一个分号或逗号连接的长字符串，
  // 这里统一拆成独立 scope，避免 scopeAllowsPath 永远匹配失败。
  const raw = contract?.boundaries?.allowedScopes;
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const scopes = [];
  for (const entry of entries) {
    for (const part of String(entry || '').split(/[;,\n]+/)) {
      const scope = part.trim().replace(/^\.\//, '').replace(/\/+$/, '');
      if (scope && !scopes.includes(scope)) {
        scopes.push(scope);
      }
    }
  }
  return scopes;
}

function scopeAllowsPath(contract, rel) {
  if (!rel) {
    return false;
  }
  const scopes = normalizedScopes(contract);
  return scopes.some((scope) => {
    if (scope === '.' || scope === '*') {
      return true;
    }
    if (scope === 'harness-control-plane') {
      return isControlPlanePath(rel);
    }
    return rel === scope || rel.startsWith(`${scope}/`);
  });
}

function isControlPlanePath(rel) {
  const stateFiles = [
    'governance/runtime-state/harness-state.json',
    'governance/runtime-state/goal-contract.json',
    'governance/runtime-state/evidence-ledger.jsonl'
  ];
  if (stateFiles.includes(rel)) {
    return true;
  }
  const controlPrefixes = [
    '.codex/',
    'governance/runtime-config-AI运行配置/config-配置文件/settings-claude运行配置.json',
    'governance/runtime-config-AI运行配置/runtime-code-运行代码/hooks-钩子/',
    'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/harness-'
  ];
  return controlPrefixes.some((prefix) => rel === prefix || rel.startsWith(prefix));
}

function contractLooksHarnessScoped(contract) {
  const scopes = normalizedScopes(contract).join(' ');
  const text = [
    contract?.objective,
    contract?.sourceGoal,
    scopes
  ].filter(Boolean).join(' ').toLowerCase();
  return text.includes('harness') || text.includes('codex') || scopes.includes('harness-control-plane');
}

function commandTargetObject(command) {
  if (isPlainDocumentRead(command)) return '';
  if (/\b(vercel|netlify|wrangler|firebase|railway|render)\b[^;\n]*(--prod|deploy|publish)/.test(command)) {
    return 'business-deploy';
  }
  if (/\bsupabase\b[^;\n]*(db\s+(push|reset)|migration\s+up|functions\s+deploy)/.test(command)) {
    return 'database-provider';
  }
  if (/\b(stripe|resend)\b[^;\n]*(create|delete|update|deploy|webhook)/.test(command)) {
    return 'billing-or-messaging-provider';
  }
  if (/\bgit\s+push(\s|$)/.test(command)) {
    return 'remote-git';
  }
  if (/\b(curl|wget|http)\b[^;\n]*\b(POST|PUT|PATCH|DELETE)\b/i.test(command)) {
    return 'external-http-write';
  }
  return '';
}

function actionTargetObject(repoRoot, payload, command) {
  const filePath = payloadFilePath(payload);
  if (isHarnessRuntimeStatePath(repoRoot, filePath)) {
    return 'harness-runtime-state';
  }
  const rel = normalizeRepoRelative(repoRoot, filePath);
  if (rel) {
    if ([
      'governance/runtime-state/harness-state.json',
      'governance/runtime-state/goal-contract.json',
      'governance/runtime-state/evidence-ledger.jsonl'
    ].includes(rel)) {
      return 'harness-runtime-state';
    }
    if (isControlPlanePath(rel)) {
      return 'harness-control-plane';
    }
    if (rel.startsWith('product-truth/product-code/')) {
      return 'business-app';
    }
    if (rel.startsWith('product-truth/')) {
      return 'product-truth';
    }
    return 'repository-file';
  }
  return commandTargetObject(command) || 'repository-local';
}

function actionImpact(category, targetObject, commandRisk, controlRisk) {
  if (commandRisk || controlRisk) {
    return 'high';
  }
  if (['business-deploy', 'database-provider', 'billing-or-messaging-provider', 'remote-git', 'external-http-write'].includes(targetObject)) {
    return 'high';
  }
  if (targetObject === 'harness-control-plane' || targetObject === 'harness-runtime-state') {
    return 'high';
  }
  if (category === 'edit' || category === 'command') {
    return 'medium';
  }
  return 'low';
}

function matrixRow(id, label, status, detail, action = '') {
  return {
    id,
    label,
    status,
    detail,
    action,
    blocking: status === MATRIX_STATUS.BLOCK || status === MATRIX_STATUS.APPROVAL
  };
}

function targetDriftRisk(contract, targetObject, category) {
  if (!contractLooksHarnessScoped(contract)) {
    return '';
  }
  const blockedTargets = new Set([
    'business-app',
    'business-deploy',
    'database-provider',
    'billing-or-messaging-provider',
    'external-http-write'
  ]);
  if (blockedTargets.has(targetObject)) {
    return `target drift: Harness goal cannot autonomously act on ${targetObject}`;
  }
  if (category === 'command' && targetObject === 'remote-git') {
    return 'target drift: Harness goal cannot autonomously mutate remote git';
  }
  return '';
}

function scopeRisk(contract, category, rel) {
  const scopes = normalizedScopes(contract);
  if (category !== 'edit' || !rel || scopes.length === 0) {
    return '';
  }
  if (scopeAllowsPath(contract, rel)) {
    return '';
  }
  return `scope mismatch: ${rel} is outside allowedScopes`;
}

function pathWithin(rel, root) {
  const normalizedRoot = String(root || '').replace(/\/+$/, '');
  return rel === normalizedRoot || rel.startsWith(`${normalizedRoot}/`);
}

function isMarkdownPath(rel) {
  return /\.md$/i.test(rel);
}

function registeredDocumentAllows(repoRoot, rel) {
  const registry = readJson(paths(repoRoot).registryPath, null);
  const documents = registry?.documents || [];
  return documents.some((entry) => {
    if (entry.enabled === false || !entry.path) {
      return false;
    }
    const entryPath = String(entry.path).replace(/\/+$/, '');
    if (entry.kind === 'directory') {
      return pathWithin(rel, entryPath);
    }
    return rel === entryPath;
  });
}

function familyAllowsNewDocument(rules, rel) {
  const families = rules?.rules?.documentInventory?.newDocumentPolicy?.allowedFamilies || [];
  return families.some((family) => {
    if (!pathWithin(rel, family.root)) {
      return false;
    }
    const filePart = rel.slice(String(family.root).replace(/\/+$/, '').length + 1);
    try {
      return new RegExp(family.filenamePattern).test(filePart);
    } catch {
      return false;
    }
  });
}

function documentEditRisk(repoRoot, payload, category) {
  if (category !== 'edit') {
    return '';
  }
  const rel = normalizeRepoRelative(repoRoot, payloadFilePath(payload));
  if (!rel || !isMarkdownPath(rel)) {
    return '';
  }
  if (pathWithin(rel, 'product-truth/product-code')) {
    return '';
  }
  const absolute = path.join(repoRoot, rel);
  if (fs.existsSync(absolute)) {
    return '';
  }
  const rules = readJson(paths(repoRoot).documentRulesPath, null);
  const policy = rules?.rules?.documentInventory?.newDocumentPolicy;
  if (!policy?.requireRegisteredOrAllowedFamily) {
    return '';
  }
  if (registeredDocumentAllows(repoRoot, rel) || familyAllowsNewDocument(rules, rel)) {
    return '';
  }
  return `new document requires document-governance registration or allowed family: ${rel}`;
}

function controlPlaneEditRisk(repoRoot, contract, payload) {
  const filePath = payloadFilePath(payload);
  if (isHarnessRuntimeStatePath(repoRoot, filePath)) {
    return `direct edit to Harness runtime state is forbidden: ${filePath}`;
  }
  const rel = normalizeRepoRelative(repoRoot, filePath);
  if (!rel) {
    return '';
  }

  const stateFiles = [
    'governance/runtime-state/harness-state.json',
    'governance/runtime-state/goal-contract.json',
    'governance/runtime-state/evidence-ledger.jsonl'
  ];
  if (stateFiles.includes(rel)) {
    return `direct edit to Harness runtime state is forbidden: ${rel}`;
  }

  if (!isControlPlanePath(rel)) {
    return '';
  }

  if (!scopeAllowsPath(contract, rel)) {
    return `control-plane edit requires explicit allowed scope: ${rel}`;
  }
  return '';
}

function buildActionEvaluationMatrix(repoRoot, details) {
  const {
    state,
    gate,
    gateId,
    contract,
    payload,
    rawToolName,
    toolName,
    category,
    level,
    autonomy,
    allowedTools,
    command,
    commandRisk,
    controlRisk,
    documentRisk
  } = details;
  const rel = normalizeRepoRelative(repoRoot, payloadFilePath(payload));
  const targetObject = actionTargetObject(repoRoot, payload, command);
  const impact = actionImpact(category, targetObject, commandRisk, controlRisk);
  const driftRisk = targetDriftRisk(contract, targetObject, category);
  const scopedRisk = scopeRisk(contract, category, rel);
  const externalTargets = new Set([
    'business-deploy',
    'database-provider',
    'billing-or-messaging-provider',
    'remote-git',
    'external-http-write'
  ]);
  const gateAllowsTool = allowedTools.includes('*') ||
    allowedTools.includes(toolName) ||
    allowedTools.includes(rawToolName);

  const rows = [
    matrixRow(
      'target_object',
      'Target object',
      driftRisk ? MATRIX_STATUS.BLOCK : MATRIX_STATUS.PASS,
      driftRisk || `target=${targetObject}; objective=${contract?.objective || '-'}; path=${rel || '-'}`
    ),
    matrixRow(
      'action_type',
      'Action type',
      MATRIX_STATUS.INFO,
      `tool=${rawToolName || toolName}; normalized=${toolName}; category=${category}; impact=${impact}`
    ),
    matrixRow(
      'autonomy',
      'Autonomy budget',
      (category === 'edit' && !autonomy.canEdit) || (category === 'command' && !autonomy.canRunLocalCommands && gate?.phase !== 'research' && gate?.phase !== 'verify')
        ? MATRIX_STATUS.BLOCK
        : MATRIX_STATUS.PASS,
      `level=${level}; canEdit=${autonomy.canEdit}; canRunLocalCommands=${autonomy.canRunLocalCommands}`
    ),
    matrixRow(
      'gate',
      'Stage gate',
      gateAllowsTool ? MATRIX_STATUS.PASS : MATRIX_STATUS.BLOCK,
      `gate=${gateId}; phase=${gate?.phase || state.phase || '-'}; allowed=${allowedTools.join(',') || '-'}`
    ),
    matrixRow(
      'scope',
      'Allowed scope',
      scopedRisk ? MATRIX_STATUS.BLOCK : MATRIX_STATUS.PASS,
      scopedRisk || `allowedScopes=${normalizedScopes(contract).join(',') || '-'}; path=${rel || '-'}`
    ),
    matrixRow(
      'external_side_effect',
      'External side effect',
      externalTargets.has(targetObject) || commandRisk
        ? MATRIX_STATUS.APPROVAL
        : MATRIX_STATUS.PASS,
      commandRisk || `target=${targetObject}; command=${command || '-'}`
    ),
    matrixRow(
      'control_plane',
      'Control-plane protection',
      controlRisk ? MATRIX_STATUS.BLOCK : MATRIX_STATUS.PASS,
      controlRisk || `target=${targetObject}; controlPlane=${targetObject === 'harness-control-plane' || targetObject === 'harness-runtime-state'}`
    ),
    matrixRow(
      'document_governance',
      'Document governance',
      documentRisk ? MATRIX_STATUS.BLOCK : MATRIX_STATUS.PASS,
      documentRisk || (rel && isMarkdownPath(rel) ? 'markdown path conforms to document governance' : 'not a markdown document write')
    ),
    matrixRow(
      'rollback',
      'Rollback path',
      impact === 'high' ? MATRIX_STATUS.INFO : MATRIX_STATUS.PASS,
      impact === 'high'
        ? 'high-impact action requires explicit rollback note before completion'
        : 'low/medium impact action; standard git rollback is sufficient'
    ),
    matrixRow(
      'evidence',
      'Evidence requirement',
      MATRIX_STATUS.INFO,
      impact === 'high'
        ? 'record command, result, target, risk, and rollback in evidence ledger'
        : 'record validation evidence before claiming completion'
    )
  ];

  return {
    targetObject,
    impact,
    highImpact: impact === 'high',
    driftRisk,
    scopeRisk: scopedRisk,
    documentRisk,
    rows
  };
}

function evaluateToolUse(repoRoot, payload = {}) {
  const state = loadState(repoRoot);
  const gateId = activeGate(state);
  if (!gateId) {
    return { ok: true, mode: state.mode || 'permissive' };
  }
  if (gateId === '__missing__') {
    return { ok: false, reason: 'state is enforcing but activeGates is empty', gate: gateId, exitCode: 2 };
  }

  const settings = loadSettings(repoRoot);
  const gate = settings.gates?.[gateId];
  if (!gate) {
    return { ok: false, reason: `unknown active gate: ${gateId}`, gate: gateId, exitCode: 2 };
  }

  const rawToolName = payload.tool_name || payload.toolName || payload.tool?.name || payload.tool || payload.name || payload.mcp_tool_name || '';
  const toolName = normalizeToolName(rawToolName);
  if (!toolName) {
    return { ok: false, reason: 'cannot identify tool name', gate: gateId, exitCode: 2 };
  }

  const allowedTools = gate.tools || gate.allowedTools || [];
  const contract = loadContract(repoRoot);
  const level = normalizeAutonomyLevel(contract?.autonomyBudget?.level || 'A0');
  const autonomy = AUTONOMY_LEVELS[level];
  const category = toolCategory(toolName);
  const rawCommand = commandTextFromPayload(payload);
  if (category === 'edit' && rawCommand.startsWith('*** Begin Patch')) {
    const targets = [...rawCommand.matchAll(/^\*\*\* (?:Update File|Add File|Delete File|Move to): (.+)$/gm)].map((match) => match[1]);
    if (!targets.length) return { ok: false, reason: 'patch targets missing', gate: gateId, exitCode: 2 };
    // Every patch destination must pass ordinary file-edit scope/control checks.
    for (const target of targets) {
      const result = evaluateToolUse(repoRoot, { tool_name: rawToolName, tool_input: { file_path: target } });
      if (!result.ok) return result;
    }
    return { ok: true, gate: gateId, patchTargets: targets };
  }
  const command = category === 'command' ? rawCommand : '';
  if (category === 'command' && HARNESS_CONTROL_COMMAND.test(command)) {
    return { ok: true, gate: gateId, controlPlaneCommand: true };
  }
  const commandRisk = detectCommandRisk(command);
  const controlRisk = category === 'edit' ? controlPlaneEditRisk(repoRoot, contract, payload) : '';
  const documentRisk = documentEditRisk(repoRoot, payload, category);
  const actionMatrix = buildActionEvaluationMatrix(repoRoot, {
    state,
    gate,
    gateId,
    contract,
    payload,
    rawToolName,
    toolName,
    category,
    level,
    autonomy,
    allowedTools,
    command,
    commandRisk,
    controlRisk,
    documentRisk
  });

  if (actionMatrix.driftRisk) {
    return {
      ok: false,
      reason: actionMatrix.driftRisk,
      matrix: actionMatrix,
      gate: gateId,
      phase: gate.phase || state.phase || '-',
      tool: rawToolName || toolName,
      command,
      exitCode: 2
    };
  }

  if (controlRisk) {
    return { ok: false, reason: controlRisk, matrix: actionMatrix, gate: gateId, tool: toolName, exitCode: 2 };
  }

  if (documentRisk) {
    return { ok: false, reason: documentRisk, matrix: actionMatrix, gate: gateId, tool: toolName, exitCode: 2 };
  }

  if (actionMatrix.scopeRisk) {
    return {
      ok: false,
      reason: actionMatrix.scopeRisk,
      matrix: actionMatrix,
      gate: gateId,
      phase: gate.phase || state.phase || '-',
      tool: rawToolName || toolName,
      command,
      exitCode: 2
    };
  }

  if (!allowedTools.includes('*') && !allowedTools.includes(toolName) && !allowedTools.includes(rawToolName)) {
    return {
      ok: false,
      reason: 'tool is not allowed in current gate',
      matrix: actionMatrix,
      gate: gateId,
      phase: gate.phase || state.phase || '-',
      tool: rawToolName || toolName,
      allowedTools,
      exitCode: 2
    };
  }

  if (category === 'edit' && !autonomy.canEdit) {
    return { ok: false, reason: `autonomy ${level} does not allow edits`, matrix: actionMatrix, gate: gateId, tool: toolName, exitCode: 2 };
  }
  if (category === 'command' && !autonomy.canRunLocalCommands && gate.phase !== 'research' && gate.phase !== 'verify') {
    return { ok: false, reason: `autonomy ${level} does not allow commands in ${gate.phase}`, matrix: actionMatrix, gate: gateId, tool: toolName, exitCode: 2 };
  }

  if (commandRisk) {
    const approvalId = consumeActionApproval(repoRoot, command, payload);
    if (approvalId) {
      const row = actionMatrix.rows.find((item) => item.id === 'external_side_effect');
      if (row) Object.assign(row, { status: MATRIX_STATUS.PASS, blocking: false, detail: `explicit single-use approval: ${approvalId}; execution not yet verified` });
      return { ok: true, matrix: actionMatrix, gate: gateId, explicitActionApproval: approvalId };
    }
    return {
      ok: false,
      reason: 'high-risk command requires explicit user approval',
      matrix: actionMatrix,
      risk: commandRisk,
      command,
      gate: gateId,
      exitCode: 2
    };
  }

  return { ok: true, matrix: actionMatrix, gate: gateId, phase: gate.phase || state.phase || '-', tool: toolName };
}

function auditRow(id, label, status, detail) {
  return {
    id,
    label,
    status,
    detail,
    blocking: status === MATRIX_STATUS.BLOCK || status === MATRIX_STATUS.APPROVAL
  };
}

function latestFailingEvidence(contract) {
  return evidenceEntries(contract).filter((entry) => String(entry.status || '').toLowerCase() === 'fail');
}

function completionAudit(repoRoot) {
  const state = loadState(repoRoot);
  const contract = loadContract(repoRoot);
  const rows = [];

  if (!contract) {
    rows.push(auditRow('goal_contract', 'Goal contract', MATRIX_STATUS.BLOCK, 'goal contract is missing'));
    return {
      ok: false,
      status: 'blocked',
      rows,
      blockers: rows.filter((row) => row.blocking).map((row) => row.detail),
      warnings: []
    };
  }

  const validationErrors = validateContract(contract);
  rows.push(auditRow(
    'goal_contract',
    'Goal contract',
    validationErrors.length ? MATRIX_STATUS.BLOCK : MATRIX_STATUS.PASS,
    validationErrors.length ? validationErrors.join('; ') : `contract=${contract.id}; status=${contract.status}`
  ));

  const sovereigntyErrors = [];
  if (!contract.sovereignty?.originalGoalHash) {
    sovereigntyErrors.push('sovereignty.originalGoalHash is missing');
  }
  const revisions = contract.revisions || [];
  if (!revisions.length) {
    if (hashText(contract.sourceGoal) !== contract.sovereignty.originalGoalHash) sovereigntyErrors.push('sourceGoal hash changed after intake');
  } else {
    if (revisions[0]?.previousObjectiveHash !== contract.sovereignty.originalGoalHash) sovereigntyErrors.push('goal revision chain does not start at originalGoalHash');
    revisions.forEach((revision, index) => {
      if (!String(revision.authority || '').trim() || !String(revision.by || '').trim()) sovereigntyErrors.push(`goal revision ${index + 1} has no user authority or actor`);
      if (!String(revision.approvedBy || '').trim() || !revision.approvedAt) sovereigntyErrors.push(`goal revision ${index + 1} was not re-approved`);
      if (index > 0 && revision.previousObjectiveHash !== revisions[index - 1].newObjectiveHash) sovereigntyErrors.push(`goal revision chain breaks at revision ${index + 1}`);
    });
    const lastRevision = revisions[revisions.length - 1];
    if (lastRevision?.newObjectiveHash !== hashText(contract.sourceGoal)) sovereigntyErrors.push('current sourceGoal does not match the latest approved revision');
    if (contract.sovereignty?.currentGoalHash !== lastRevision?.newObjectiveHash) sovereigntyErrors.push('sovereignty.currentGoalHash does not match the latest revision');
  }
  if (contract.sovereignty?.agentMayRedefineGoal !== false) {
    sovereigntyErrors.push('agentMayRedefineGoal must be false');
  }
  if (contract.sourceGoal && contract.objective && contract.sourceGoal !== contract.objective) sovereigntyErrors.push('objective differs from sourceGoal');
  rows.push(auditRow(
    'goal_sovereignty',
    'Goal sovereignty',
    sovereigntyErrors.length ? MATRIX_STATUS.BLOCK : MATRIX_STATUS.PASS,
    sovereigntyErrors.length ? sovereigntyErrors.join('; ') : 'goal chain preserves the original hash and all revisions are user-authorized and re-approved'
  ));

  const readinessBlockers = evaluateIntakeReadiness(contract).filter((item) => item.level === 'block');
  rows.push(auditRow(
    'intake_readiness',
    'Intake readiness',
    readinessBlockers.length ? MATRIX_STATUS.BLOCK : MATRIX_STATUS.PASS,
    readinessBlockers.length ? readinessBlockers.map((item) => `${item.name}: ${item.detail}`).join('; ') : 'research/user-intent/assumption split is executable'
  ));

  const incompleteCheckpoints = (contract.checkpoints || []).filter((item) => !checkpointStatusOk(item.status));
  rows.push(auditRow(
    'checkpoints',
    'Checkpoints',
    incompleteCheckpoints.length ? MATRIX_STATUS.BLOCK : MATRIX_STATUS.PASS,
    incompleteCheckpoints.length
      ? `pending=${incompleteCheckpoints.map((item) => item.name || item.id).join(', ')}`
      : 'all checkpoints completed'
  ));

  const missingCriteria = (contract.successCriteria || []).filter((criterion) => !hasPassingEvidence(contract, criterion));
  rows.push(auditRow(
    'success_criteria',
    'Success criteria',
    missingCriteria.length ? MATRIX_STATUS.BLOCK : MATRIX_STATUS.PASS,
    missingCriteria.length ? `missing evidence for: ${missingCriteria.join('; ')}` : 'each success criterion has passing evidence'
  ));

  const missingRequiredEvidence = (contract.evidence?.required || []).filter((item) => !hasPassingEvidence(contract, item));
  rows.push(auditRow(
    'required_evidence',
    'Required evidence',
    missingRequiredEvidence.length ? MATRIX_STATUS.BLOCK : MATRIX_STATUS.PASS,
    missingRequiredEvidence.length ? `missing: ${missingRequiredEvidence.join('; ')}` : 'all required evidence classes are present'
  ));

  const failingEvidence = latestFailingEvidence(contract);
  rows.push(auditRow(
    'failing_evidence',
    'Failing evidence',
    failingEvidence.length ? MATRIX_STATUS.BLOCK : MATRIX_STATUS.PASS,
    failingEvidence.length ? `unresolved failing evidence: ${failingEvidence.map((item) => item.summary || item.type).join('; ')}` : 'no failing evidence recorded'
  ));

  const completionPhaseOk = ['verify', 'evidence', 'complete'].includes(contract.phase?.current || state.phase || '');
  rows.push(auditRow(
    'completion_phase',
    'Completion phase',
    completionPhaseOk ? MATRIX_STATUS.PASS : MATRIX_STATUS.BLOCK,
    completionPhaseOk
      ? `phase=${contract.phase?.current || state.phase}`
      : `phase=${contract.phase?.current || state.phase || '-'}; move to verify/evidence before completion`
  ));

  const blockers = rows.filter((row) => row.blocking).map((row) => row.detail);
  const warnings = rows.filter((row) => row.status === MATRIX_STATUS.INFO).map((row) => row.detail);
  return {
    ok: blockers.length === 0,
    status: blockers.length ? 'blocked' : 'pass',
    goalId: contract.id,
    phase: contract.phase?.current || state.phase || '-',
    rows,
    blockers,
    warnings
  };
}

function completeGoal(repoRoot, options = {}) {
  const audit = completionAudit(repoRoot);
  if (!audit.ok) {
    throw new Error(`completion audit failed: ${audit.blockers.join('; ')}`);
  }
  const contract = loadContract(repoRoot);
  contract.status = 'complete';
  contract.completedAt = nowIso();
  contract.completedBy = options.by || 'user';
  saveContract(repoRoot, contract);
  const result = setPhase(repoRoot, 'complete', 'completion audit passed', { skipCompletionAudit: true });
  return { ...result, audit };
}

function recordEvidence(repoRoot, entry) {
  const contract = loadContract(repoRoot);
  if (!contract) {
    throw new Error('goal contract is required');
  }
  const now = nowIso();
  const normalized = {
    at: now,
    type: entry.type || 'note',
    status: entry.status || 'info',
    summary: entry.summary || '',
    detail: entry.detail || ''
  };
  const satisfies = Array.isArray(entry.satisfies) ? entry.satisfies : parseCsv(entry.satisfies);
  if (satisfies.length) {
    normalized.satisfies = satisfies;
  }
  contract.evidence = contract.evidence || { required: [], collected: [] };
  contract.evidence.collected = contract.evidence.collected || [];
  contract.evidence.collected.push(normalized);
  saveContract(repoRoot, contract);
  appendJsonl(paths(repoRoot).evidenceLedgerPath, {
    goalId: contract.id,
    objective: contract.objective,
    ...normalized
  });
  return normalized;
}

function runtimeValidation(repoRoot) {
  const checks = [];
  const p = paths(repoRoot);
  const settings = readJson(p.settingsPath, null);
  const state = readJson(p.statePath, null);
  const contract = readJson(p.contractPath, null);

  if (!settings) {
    checks.push({ level: 'fail', name: 'settings', detail: 'missing or invalid' });
  } else {
    for (const [phase, gate] of Object.entries(PHASE_TO_GATE)) {
      if (gate && !settings.gates?.[gate]) {
        checks.push({ level: 'fail', name: 'phase gate mapping', detail: `${phase} -> ${gate} missing` });
      }
    }
  }

  if (!state) {
    checks.push({ level: 'fail', name: 'state', detail: 'missing or invalid' });
  } else if (state.mode === 'enforcing' && !(state.activeGates || []).length) {
    checks.push({ level: 'fail', name: 'state active gate', detail: 'enforcing with empty activeGates' });
  }

  if (contract) {
    for (const error of validateContract(contract)) {
      checks.push({ level: 'fail', name: 'goal contract', detail: error });
    }
    const phase = contract.phase?.current || state?.phase;
    const allowed = canEnterPhase(contract, phase);
    if (!allowed.ok) {
      checks.push({ level: 'fail', name: 'goal phase', detail: allowed.reason });
    }
  }

  return checks;
}

module.exports = {
  approveAction,
  actionBinding,
  AUTONOMY_LEVELS,
  HIGH_RISK_PATTERNS,
  MATRIX_STATUS,
  PHASE_TO_GATE,
  activeGate,
  actionTargetObject,
  approveContract,
  autonomyAllowedItems,
  buildActionEvaluationMatrix,
  canEnterPhase,
  clearGoal,
  commandTextFromPayload,
  completeGoal,
  completionAudit,
  detectCommandRisk,
  evaluateIntakeReadiness,
  evaluateToolUse,
  loadContract,
  loadSettings,
  loadState,
  makeGoalContract,
  normalizeAutonomyLevel,
  normalizeToolName,
  paths,
  readJson,
  recordEvidence,
  repoRootFromRegistry,
  reviseContract,
  runtimeValidation,
  saveContract,
  saveState,
  setPhase,
  startGoal,
  updateCheckpoint,
  validateContract,
  writeJson
};
