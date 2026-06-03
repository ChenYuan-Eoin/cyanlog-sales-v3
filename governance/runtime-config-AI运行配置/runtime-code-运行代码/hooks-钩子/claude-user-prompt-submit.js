#!/usr/bin/env node

// 思维层治理: 提示 AI 在此 hook 触发后,先输出"目标+路径+验证"
// 详细规范见 governance/truth-docs-治理真相文档/THINKING_GOVERNANCE.md
// 本 hook 不做逻辑改动(避免引入新失败点),仅作为最后一道注释提醒

const fs = require('fs');

const input = fs.readFileSync(0, 'utf8');
const payload = input ? JSON.parse(input) : {};
const prompt = payload.prompt || '';

if (/(确认|合并|F[0-9]{3})/i.test(prompt)) {
  process.stdout.write('TRIGGER_SOCRATES\n');
}
