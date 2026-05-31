// REQ:GOV-V002
// PURPOSE: PRD 同步检查 - 确保 REQUIREMENTS.md 与 PRD-PRODUCT.md 一致

const fs = require('fs');
const { resolveEnabledDocumentPath } = require('../scripts-脚本/project-registry');

const prdDoc = resolveEnabledDocumentPath('product-prd');
const requirementsDoc = resolveEnabledDocumentPath('requirements');
const PRD_FILE = prdDoc ? prdDoc.absolutePath : null;
const REQ_FILE = requirementsDoc ? requirementsDoc.absolutePath : null;

function extractReqIds(content) {
  const ids = new Set();
  const matches = content.match(/F\d{3}/g);
  if (matches) {
    matches.forEach(id => ids.add(id));
  }
  return ids;
}

function parseReqStatus(content) {
  const statuses = new Map();
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/\|\s*(F\d{3})\s*\|[^|]+\|[^|]+\|\s*(\S+)\s*\|/);
    if (match) {
      statuses.set(match[1], match[2]);
    }
  }

  return statuses;
}

function main() {
  if (!PRD_FILE || !REQ_FILE) {
    console.log('ℹ️ Product truth layer not enabled, skipping PRD sync check');
    process.exit(0);
  }

  try {
    const prdContent = fs.readFileSync(PRD_FILE, 'utf-8');
    const reqContent = fs.readFileSync(REQ_FILE, 'utf-8');

    const prdIds = extractReqIds(prdContent);
    const reqIds = extractReqIds(reqContent);

    let exitCode = 0;
    const issues = [];

    for (const id of reqIds) {
      if (!prdIds.has(id)) {
        issues.push(`${id} in REQUIREMENTS but not in PRD`);
        exitCode = 1;
      }
    }

    if (issues.length === 0) {
      console.log('✅ PRD sync check passed');
    } else {
      console.log('⚠️  PRD sync issues:');
      issues.forEach(i => console.log(`   - ${i}`));
    }

    process.exit(exitCode);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(2);
  }
}

main();
