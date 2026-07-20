#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const input = fs.readFileSync(0, 'utf8');
const payload = input ? JSON.parse(input) : {};
const prompt = payload.prompt || '';

const workspaceRoot = process.env.PRICE_V3_WORKSPACE_ROOT ||
  path.resolve(__dirname, '../../../..');
const statePath = path.join(workspaceRoot, 'governance/runtime-state/active-task.json');

try {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const activeId = state.active_task && state.active_task.id;
  const baselineStatus = state.product_baseline && state.product_baseline.status;
  process.stdout.write(
    `SCHEDULER active=${activeId} baseline=${baselineStatus}. ` +
    'Classify this prompt before acting. New requirements, ordinary bugs and technical leads go to Inbox; ' +
    'do not switch Active without impact assessment and explicit user approval.\n'
  );
} catch (error) {
  process.stderr.write(`SCHEDULER_STATE_ERROR: ${error.message}\n`);
  process.exit(2);
}

if (/(确认|合并|F[0-9]{3})/i.test(prompt)) {
  process.stdout.write('TRIGGER_SOCRATES\n');
}
