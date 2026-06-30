#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  getHarnessRuntime,
  loadRegistry
} = require('./project-registry');
const { runtimeValidation } = require('./harness-core');

const checks = [];

function record(level, name, detail) {
  checks.push({ level, name, detail });
}

function pass(name, detail = '') {
  record('PASS', name, detail);
}

function warn(name, detail = '') {
  record('WARN', name, detail);
}

function fail(name, detail = '') {
  record('FAIL', name, detail);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function walkFiles(rootDir, result = []) {
  if (!fs.existsSync(rootDir)) {
    return result;
  }
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__pycache__') {
      continue;
    }
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, result);
    } else if (entry.isFile()) {
      result.push(fullPath);
    }
  }
  return result;
}

function checkStaleRuntimeRefs(repoRoot) {
  const scanRoots = [
    'governance/runtime-config-AI运行配置/runtime-code-运行代码',
    'docs-governance/maintenance-config-维护配置'
  ];
  const stalePatterns = [
    ['harness-manager', '-治理管理'].join(''),
    ['governance', 'harness'].join('/')
  ];
  const selfPath = path.resolve(__filename);
  const hits = [];

  for (const relRoot of scanRoots) {
    const absRoot = path.join(repoRoot, relRoot);
    for (const filePath of walkFiles(absRoot)) {
      if (path.resolve(filePath) === selfPath) {
        continue;
      }
      let content = '';
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      for (const pattern of stalePatterns) {
        if (content.includes(pattern)) {
          hits.push(`${path.relative(repoRoot, filePath)} -> ${pattern}`);
        }
      }
    }
  }

  if (hits.length === 0) {
    pass('runtime paths use current governance layout');
  } else {
    fail('runtime paths still reference stale harness layout', hits.join('; '));
  }
}

function checkDocumentGovernance(repoRoot) {
  const validatorPath = path.join(
    repoRoot,
    'docs-governance/maintenance-config-维护配置/scripts-脚本程序/validate-doc-governance.js'
  );
  if (!fs.existsSync(validatorPath)) {
    fail('document governance validator exists', path.relative(repoRoot, validatorPath));
    return;
  }

  const result = spawnSync('node', [validatorPath], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (result.status === 0) {
    pass('document governance validation', result.stdout.trim());
  } else {
    fail('document governance validation', (result.stderr || result.stdout || '').trim());
  }
}

function checkGitHooks(repoRoot) {
  const result = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  const hooksPath = result.stdout.trim();
  if (hooksPath === '.githooks') {
    pass('git hooks path', hooksPath);
  } else {
    warn('git hooks path is not .githooks', hooksPath || '(unset)');
  }
}

function checkCodexAdapter(repoRoot) {
  const codexConfig = path.join(repoRoot, '.codex/config.toml');
  if (!fs.existsSync(codexConfig)) {
    warn('Codex project adapter missing', '.codex/config.toml not found');
    return;
  }
  pass('Codex project config exists', path.relative(repoRoot, codexConfig));

  const content = fs.readFileSync(codexConfig, 'utf8');
  if (content.includes('[features]') && content.includes('hooks = true')) {
    pass('Codex hooks feature enabled');
  } else {
    warn('Codex hooks feature not explicit', 'hooks default to enabled, but config does not say hooks = true');
  }

  if (content.includes('danger-full-access') && content.includes('approval_policy = "never"')) {
    warn('Codex project adapter is full-auto', '.codex/config.toml uses danger-full-access + never');
  } else {
    pass('Codex project permissions bounded');
  }

  const hooksPath = path.join(repoRoot, '.codex/hooks.json');
  if (!fs.existsSync(hooksPath)) {
    warn('Codex project hooks missing', '.codex/hooks.json not found');
  } else {
    try {
      const hooksConfig = readJson(hooksPath);
      const requiredEvents = ['UserPromptSubmit', 'PreToolUse', 'Stop'];
      const missing = requiredEvents.filter((eventName) => !hooksConfig.hooks?.[eventName]);
      if (missing.length) {
        fail('Codex project hooks cover Harness lifecycle', `missing: ${missing.join(',')}`);
      } else {
        pass('Codex project hooks cover Harness lifecycle', requiredEvents.join(','));
      }
    } catch (error) {
      fail('Codex project hooks JSON parses', error.message);
    }
  }

  const adapterPath = path.join(repoRoot, '.codex/hooks/harness-adapter.js');
  if (fs.existsSync(adapterPath)) {
    pass('Codex Harness adapter exists', path.relative(repoRoot, adapterPath));
  } else {
    fail('Codex Harness adapter exists', path.relative(repoRoot, adapterPath));
  }

  const userConfig = path.join(process.env.HOME || '', '.codex/config.toml');
  if (fs.existsSync(userConfig)) {
    const userContent = fs.readFileSync(userConfig, 'utf8');
    if (userContent.includes(`[projects."${repoRoot}"]`) && userContent.includes('trust_level = "trusted"')) {
      pass('Codex project is trusted');
    } else {
      warn('Codex project trust not confirmed', 'project-local hooks load only for trusted projects');
    }
    if (userContent.includes(`${repoRoot}/.codex/hooks.json`)) {
      pass('Codex project hook trust recorded');
    } else {
      warn('Codex project hooks need review', 'open /hooks and trust the project hook definitions');
    }
  }
}

function checkHarnessCore(repoRoot) {
  const scriptsDir = path.join(repoRoot, 'governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本');
  const corePath = path.join(scriptsDir, 'harness-core.js');
  const goalPath = path.join(scriptsDir, 'harness-goal.js');
  const selftestPath = path.join(scriptsDir, 'harness-selftest.js');
  const packagePath = path.join(scriptsDir, 'package.json');

  for (const [name, filePath] of [
    ['Harness core exists', corePath],
    ['Harness goal CLI exists', goalPath],
    ['Harness selftest exists', selftestPath]
  ]) {
    if (fs.existsSync(filePath)) {
      pass(name, path.relative(repoRoot, filePath));
    } else {
      fail(name, path.relative(repoRoot, filePath));
    }
  }

  try {
    const packageJson = readJson(packagePath);
    if (packageJson.scripts?.selftest || packageJson.scripts?.test) {
      pass('Harness selftest script registered');
    } else {
      fail('Harness selftest script registered', 'package.json lacks selftest/test script');
    }
  } catch (error) {
    fail('Harness package JSON parses', error.message);
  }

  const validation = runtimeValidation(repoRoot);
  if (validation.length === 0) {
    pass('Harness runtime validation');
  } else {
    for (const item of validation) {
      fail(`Harness runtime validation: ${item.name}`, item.detail);
    }
  }
}

function main() {
  let repoRoot = '';
  let registryPath = '';
  let registry = null;

  try {
    const loaded = loadRegistry();
    repoRoot = loaded.repoRoot;
    registryPath = loaded.registryPath;
    registry = loaded.registry;
    pass('registry loads', path.relative(repoRoot, registryPath));
  } catch (error) {
    fail('registry loads', error.message);
  }

  if (!repoRoot || !registry) {
    printAndExit();
    return;
  }

  const { config } = getHarnessRuntime({ repoRoot });
  const settingsPath = config.settings ? path.join(repoRoot, config.settings) : '';
  if (settingsPath && fs.existsSync(settingsPath)) {
    pass('settings file exists', path.relative(repoRoot, settingsPath));
  } else {
    fail('settings file exists', config.settings || '(missing in registry)');
  }

  let settings = null;
  try {
    settings = readJson(settingsPath);
    pass('settings JSON parses');
  } catch (error) {
    fail('settings JSON parses', error.message);
  }

  const claudeSettings = path.join(repoRoot, '.claude/settings.json');
  if (fs.existsSync(claudeSettings)) {
    const claude = readJson(claudeSettings);
    const extendsPath = claude.extends ? path.resolve(path.dirname(claudeSettings), claude.extends) : '';
    if (extendsPath === settingsPath) {
      pass('.claude extends governance settings');
    } else {
      fail('.claude extends governance settings', claude.extends || '(missing)');
    }
  } else {
    warn('.claude settings missing');
  }

  if (settings) {
    const requiredGates = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5'];
    const missingGates = requiredGates.filter((gate) => !settings.gates?.[gate]);
    if (missingGates.length === 0) {
      pass('long-task gates defined', requiredGates.join(','));
    } else {
      fail('long-task gates defined', `missing: ${missingGates.join(',')}`);
    }

    for (const [eventName, groups] of Object.entries(settings.hooks || {})) {
      for (const group of groups || []) {
        for (const hook of group.hooks || []) {
          const args = hook.args || [];
          const usesProjectRegistry = args.some((arg) => String(arg).includes('project-registry.js'));
          if (usesProjectRegistry && hook.command !== 'node') {
            fail(`${eventName} hook command`, `project-registry.js must run with node, got ${hook.command}`);
          }
        }
      }
    }
    pass('settings hook interpreter check complete');
  }

  for (const [hookId, hook] of Object.entries(config.hook_commands || {})) {
    const hookPath = path.join(repoRoot, hook.path);
    if (fs.existsSync(hookPath)) {
      pass(`hook command exists: ${hookId}`, hook.path);
    } else {
      fail(`hook command exists: ${hookId}`, hook.path);
    }
  }

  const statePath = path.join(repoRoot, 'governance/runtime-state/harness-state.json');
  let state = null;
  try {
    state = readJson(statePath);
    pass('harness state JSON parses');
  } catch (error) {
    fail('harness state JSON parses', error.message);
  }

  if (state) {
    if (state.mode === 'enforcing' && !(state.activeGates || []).length) {
      fail('harness state active gate', 'mode=enforcing but activeGates is empty');
    } else if (state.mode === 'permissive') {
      if (state.phase === 'complete' || state.phase === 'idle') {
        pass('harness state mode', `permissive after ${state.phase}`);
      } else {
        warn('harness state mode', 'permissive mode does not enforce gates');
      }
    } else {
      pass('harness state active gate', (state.activeGates || []).join(',') || '-');
    }
  }

  checkGitHooks(repoRoot);
  checkHarnessCore(repoRoot);
  checkCodexAdapter(repoRoot);
  checkDocumentGovernance(repoRoot);
  checkStaleRuntimeRefs(repoRoot);
  printAndExit();
}

function printAndExit() {
  for (const check of checks) {
    const suffix = check.detail ? ` - ${check.detail}` : '';
    console.log(`[${check.level}] ${check.name}${suffix}`);
  }
  const failures = checks.filter((check) => check.level === 'FAIL').length;
  const warnings = checks.filter((check) => check.level === 'WARN').length;
  const strict = process.argv.includes('--strict');
  const ready = failures === 0 && warnings === 0;
  console.log(`Harness readiness: ${ready ? 'READY' : 'NOT READY'}`);
  if (!ready) {
    console.log('Harness readiness requires zero failures and zero warnings. Use --strict before claiming deployed/effective.');
  }
  console.log(`\nHarness doctor: ${failures} failure(s), ${warnings} warning(s)${strict ? ' [strict]' : ''}`);
  process.exit(failures || (strict && warnings) ? 1 : 0);
}

main();
