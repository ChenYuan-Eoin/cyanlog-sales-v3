#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { repoRootFromRegistry } = require('./harness-core');

const HOOK_EVENTS = ['pre_tool_use', 'user_prompt_submit', 'stop'];

function parseArgs(argv) {
  const options = { write: false, target: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') {
      options.write = true;
    } else if (arg === '--target') {
      options.target = argv[index + 1] || '';
      index += 1;
    } else if (!options.target) {
      options.target = arg;
    }
  }
  return options;
}

function codexConfigPath() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.join(codexHome, 'config.toml');
}

function sectionHeader(name) {
  return `[${name}]`;
}

function projectSection(repoRoot) {
  return `projects."${repoRoot}"`;
}

function hookStateKey(repoRoot, eventName) {
  return `${repoRoot}/.codex/hooks.json:${eventName}:0:0`;
}

function hookSection(repoRoot, eventName) {
  return `hooks.state."${hookStateKey(repoRoot, eventName)}"`;
}

function extractTrustedHash(config, repoRoot, eventName) {
  const key = hookStateKey(repoRoot, eventName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\[hooks\\.state\\."${key}"\\][\\s\\S]*?trusted_hash\\s*=\\s*"([^"]+)"`);
  const match = config.match(pattern);
  return match ? match[1] : '';
}

function hasSection(config, name) {
  return config.includes(sectionHeader(name));
}

function buildEntries(config, sourceRoot, targetRoot) {
  const entries = [];
  const project = projectSection(targetRoot);
  if (!hasSection(config, project)) {
    entries.push({
      name: project,
      body: `${sectionHeader(project)}\ntrust_level = "trusted"\n`
    });
  }

  for (const eventName of HOOK_EVENTS) {
    const sourceHash = extractTrustedHash(config, sourceRoot, eventName);
    if (!sourceHash) {
      throw new Error(`missing source trusted_hash for ${sourceRoot} ${eventName}; review /hooks for source project first`);
    }
    const hook = hookSection(targetRoot, eventName);
    if (!hasSection(config, hook)) {
      entries.push({
        name: hook,
        body: `${sectionHeader(hook)}\ntrusted_hash = "${sourceHash}"\n`
      });
    }
  }

  return entries;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceRoot = repoRootFromRegistry();
  const targetRoot = path.resolve(options.target || process.cwd());
  const configPath = codexConfigPath();
  const config = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const entries = buildEntries(config, sourceRoot, targetRoot);

  if (!options.write) {
    console.log(`# Codex trust entries for ${targetRoot}`);
    if (!entries.length) {
      console.log('# already trusted');
      return;
    }
    console.log(entries.map((entry) => entry.body).join('\n'));
    console.log(`# Re-run with --write --target "${targetRoot}" to update ${configPath}`);
    return;
  }

  if (!entries.length) {
    console.log(`Codex trust already configured for ${targetRoot}`);
    return;
  }

  const next = `${config.replace(/\s*$/, '\n\n')}${entries.map((entry) => entry.body).join('\n')}`;
  fs.writeFileSync(configPath, next);
  console.log(`Codex trust configured for ${targetRoot}`);
  console.log(`Updated ${configPath}`);
}

main();
