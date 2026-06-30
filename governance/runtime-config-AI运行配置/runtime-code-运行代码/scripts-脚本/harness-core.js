#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadRegistry } = require('./project-registry');

const PHASE_TO_GATE = {
  intake: 'G0',
  research: 'G1',
  contract_review: 'G2',
  plan: 'G2',
  execute: 'G3',
  verify: 'G4',
  evidence: 'G4',
  approval: 'G5',
  blocked: 'G5',
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
  { pattern: /\bsupabase\b[^;\n]*(db\s+(push|reset)|migration\s+up|functions\s+deploy)/, reason: 'database or edge-function mutation' },
  { pattern: /\b(stripe|resend)\b[^;\n]*(create|delete|update|deploy|webhook)/, reason: 'billing or messaging provider mutation' },
  { pattern: /\b(drop\s+database|drop\s+schema|drop\s+table|truncate\s+table)\b/i, reason: 'destructive SQL' },
  { pattern: /\b(curl|wget|http)\b[^;\n]*\b(POST|PUT|PATCH|DELETE)\b/i, reason: 'external write request' }
];

function repoRootFromRegistry() {
  return loadRegistry().repoRoot;
}

function paths(repoRoot = repoRootFromRegistry()) {
  return {
    repoRoot,
    settingsPath: path.join(repoRoot, 'governance/runtime-config-AI运行配置/config-配置文件/settings-claude运行配置.json'),
    statePath: path.join(repoRoot, 'governance/runtime-state/harness-state.json'),
    contractPath: path.join(repoRoot, 'governance/runtime-state/goal-contract.json'),
    evidenceLedgerPath: path.join(repoRoot, 'governance/runtime-state/evidence-ledger.jsonl')
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
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

  return {
    version: '1.0',
    id: `goal-${now.replace(/[-:.TZ]/g, '').slice(0, 14)}`,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    sourceGoal: goalText,
    objective: goalText,
    successCriteria: parseCsv(options.success),
    nonGoals: parseCsv(options.nonGoals),
    researchPlan: {
      researchable: parseCsv(options.researchable),
      askUser: parseCsv(options.askUser),
      blocked: [],
      safeAssumptions: []
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
  return readJson(paths(repoRoot).contractPath, null);
}

function saveContract(repoRoot, contract) {
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
  }
  return { ok: true };
}

function setPhase(repoRoot, phase, reason = 'manual phase switch') {
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
  if (raw === 'apply_patch' || raw.endsWith('.apply_patch')) {
    return 'Edit';
  }
  if (raw === 'exec_command' || raw.endsWith('.exec_command') || raw === 'Bash') {
    return 'Bash';
  }
  if (raw.endsWith('.read_mcp_resource') || raw.endsWith('.list_mcp_resources')) {
    return 'Read';
  }
  if (raw === 'view_image' || raw.endsWith('.view_image')) {
    return 'Read';
  }
  return raw;
}

function detectCommandRisk(command = '') {
  for (const item of HIGH_RISK_PATTERNS) {
    if (item.pattern.test(command)) {
      return item.reason;
    }
  }
  return '';
}

function commandTextFromPayload(payload = {}) {
  const candidates = [
    payload.tool_input?.cmd,
    payload.tool_input?.command,
    payload.input?.cmd,
    payload.input?.command,
    payload.arguments?.cmd,
    payload.arguments?.command,
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

function controlPlaneEditRisk(repoRoot, contract, payload) {
  const rel = normalizeRepoRelative(repoRoot, payloadFilePath(payload));
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

  const controlPrefixes = [
    '.codex/',
    'governance/runtime-config-AI运行配置/config-配置文件/settings-claude运行配置.json',
    'governance/runtime-config-AI运行配置/runtime-code-运行代码/hooks-钩子/',
    'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/harness-'
  ];
  const isControlPlane = controlPrefixes.some((prefix) => rel === prefix || rel.startsWith(prefix));
  if (!isControlPlane) {
    return '';
  }

  const scopes = contract?.boundaries?.allowedScopes || [];
  const explicitlyAllowed = scopes.includes('harness-control-plane') ||
    scopes.some((scope) => rel === scope || rel.startsWith(`${scope.replace(/\/+$/, '')}/`));
  if (!explicitlyAllowed) {
    return `control-plane edit requires explicit allowed scope: ${rel}`;
  }
  return '';
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
  if (!allowedTools.includes('*') && !allowedTools.includes(toolName) && !allowedTools.includes(rawToolName)) {
    return {
      ok: false,
      reason: 'tool is not allowed in current gate',
      gate: gateId,
      phase: gate.phase || state.phase || '-',
      tool: rawToolName || toolName,
      allowedTools,
      exitCode: 2
    };
  }

  const contract = loadContract(repoRoot);
  const level = normalizeAutonomyLevel(contract?.autonomyBudget?.level || 'A0');
  const autonomy = AUTONOMY_LEVELS[level];
  const category = toolCategory(toolName);
  if (category === 'edit' && !autonomy.canEdit) {
    return { ok: false, reason: `autonomy ${level} does not allow edits`, gate: gateId, tool: toolName, exitCode: 2 };
  }
  if (category === 'edit') {
    const controlRisk = controlPlaneEditRisk(repoRoot, contract, payload);
    if (controlRisk) {
      return { ok: false, reason: controlRisk, gate: gateId, tool: toolName, exitCode: 2 };
    }
  }
  if (category === 'command' && !autonomy.canRunLocalCommands && gate.phase !== 'research' && gate.phase !== 'verify') {
    return { ok: false, reason: `autonomy ${level} does not allow commands in ${gate.phase}`, gate: gateId, tool: toolName, exitCode: 2 };
  }

  const command = commandTextFromPayload(payload);
  const commandRisk = detectCommandRisk(command);
  if (commandRisk) {
    return {
      ok: false,
      reason: 'high-risk command requires explicit user approval',
      risk: commandRisk,
      command,
      gate: gateId,
      exitCode: 2
    };
  }

  return { ok: true, gate: gateId, phase: gate.phase || state.phase || '-', tool: toolName };
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
  AUTONOMY_LEVELS,
  HIGH_RISK_PATTERNS,
  PHASE_TO_GATE,
  activeGate,
  approveContract,
  autonomyAllowedItems,
  canEnterPhase,
  clearGoal,
  commandTextFromPayload,
  detectCommandRisk,
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
  runtimeValidation,
  saveContract,
  saveState,
  setPhase,
  startGoal,
  validateContract,
  writeJson
};
