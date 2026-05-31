#!/usr/bin/env node
/**
 * Hook: H001_ReqConfirmed
 * 触发: git pre-commit / pre-tool-use:Edit
 * 行为: 检查文件对应的需求是否已确认
 *
 * 协议:
 *   exit 0 → 放行
 *   exit 2 → 阻止，提示未确认
 *   exit 1 → 硬阻断
 */

const fs = require('fs');
const {
  isWithinDocument,
  resolveEnabledDocumentPath
} = require('../scripts-脚本/project-registry');

// REQ: GOV-H001

function extractReqId(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').slice(0, 20);

    for (const line of lines) {
      const match = line.match(/REQ:\s*(\w+-\w+-\d+|F\d{3}|GOV-[A-Z]+-\d+)/);
      if (match) return match[1];
    }
    return null;
  } catch {
    return null;
  }
}

function parseRequirements() {
  const requirementsDoc = resolveEnabledDocumentPath('requirements');
  if (!requirementsDoc) {
    return null;
  }

  const reqFile = requirementsDoc.absolutePath;
  const content = fs.readFileSync(reqFile, 'utf-8');
  const lines = content.split('\n');

  const reqs = [];
  // Match: | F001 | name | ... | **已确认** | ... |
  const pattern = /\|\s*(F\d{3})\s*\|[^|]+\|[^|]+\|\s*(\*\*)?(待确认|已确认)(\*\*)?\s*\|/;

  for (const line of lines) {
    const match = line.match(pattern);
    if (match) {
      reqs.push({
        id: match[1],
        status: match[3] // "待确认" or "已确认"
      });
    }
  }

  return reqs;
}

function checkGovReq(reqId) {
  // 治理层文档直接通过
  if (reqId.startsWith('GOV-')) {
    return { ok: true };
  }
  return null;
}

function main() {
  const targetFile = process.argv[2];

  if (!targetFile) {
    console.error('Usage: node H001_ReqConfirmed.js <file-path>');
    process.exit(1);
  }

  if (!isWithinDocument(targetFile, 'product-src')) {
    process.exit(0);
  }

  const reqId = extractReqId(targetFile);

  if (!reqId) {
    console.error('========================================');
    console.error('❌ H001_ReqConfirmed: 阻止操作');
    console.error('========================================');
    console.error(`文件: ${targetFile}`);
    console.error('原因: 文件缺少 REQ ID 标记');
    console.error('');
    console.error('解决: 在文件头添加注释:');
    console.error('  // REQ: F001');
    console.error('或:');
    console.error('  REQ: GOV-XXX-001');
    console.error('========================================');
    process.exit(2);
  }

  // 治理层检查
  const govCheck = checkGovReq(reqId);
  if (govCheck) {
    if (govCheck.ok) {
      console.log(`✅ H001: REQ ${reqId} 是治理层文档，放行`);
      process.exit(0);
    }
  }

  // 业务需求检查
  const reqs = parseRequirements();
  if (!reqs) {
    console.log('ℹ️ Requirements tracking not enabled, skipping confirmation check');
    process.exit(0);
  }
  const req = reqs.find(r => r.id === reqId);

  if (!req) {
    console.error('========================================');
    console.error('❌ H001_ReqConfirmed: 阻止操作');
    console.error('========================================');
    console.error(`文件: ${targetFile}`);
    console.error(`REQ ID: ${reqId}`);
    console.error('原因: REQ ID 在 REQUIREMENTS.md 中不存在');
    console.error('');
    console.error('解决: 先在 REQUIREMENTS.md 中定义该需求');
    console.error('========================================');
    process.exit(2);
  }

  if (req.status !== '已确认') {
    console.error('========================================');
    console.error('❌ H001_ReqConfirmed: 阻止操作');
    console.error('========================================');
    console.error(`文件: ${targetFile}`);
    console.error(`REQ ID: ${reqId}`);
    console.error(`当前状态: "${req.status}"`);
    console.error('必需状态: "已确认"');
    console.error('');
    console.error('解决: 先在 REQUIREMENTS.md 中将状态改为"已确认"');
    console.error('========================================');
    process.exit(2);
  }

  console.log(`✅ H001: REQ ${reqId} 已确认，放行`);
  process.exit(0);
}

main();
