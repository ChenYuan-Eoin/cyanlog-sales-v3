// REQ:GOV-V001
// PURPOSE: 需求状态验证器 - 检查需求是否已确认
// 检验: 是否存在，状态是否正确

const fs = require('fs');
const { resolveEnabledDocumentPath } = require('../scripts-脚本/project-registry');

const requirementsDoc = resolveEnabledDocumentPath('requirements');
const REQUIREMENTS_FILE = requirementsDoc ? requirementsDoc.absolutePath : null;

/**
 * 解析 REQ_REGISTRY.yml 获取需求状态
 */
function parseRequirements() {
  const reqs = new Map();

  if (!REQUIREMENTS_FILE) {
    return null;
  }

  try {
    const content = fs.readFileSync(REQUIREMENTS_FILE, 'utf-8');

    // 简单 YAML 解析：提取 Fxxx 状态
    const lines = content.split('\n');
    let currentReq = null;

    for (const line of lines) {
      // 匹配需求ID行: F001:
      const idMatch = line.match(/^(F\d{3}):\s*$/);
      if (idMatch) {
        currentReq = { id: idMatch[1], status: null };
        reqs.set(idMatch[1], currentReq);
        continue;
      }

      // 匹配状态行: status: xxx
      if (currentReq) {
        const statusMatch = line.match(/^\s+status:\s*(\S+)/);
        if (statusMatch) {
          const statusEn = statusMatch[1];
          // 转换为中文状态保持兼容性
          const statusMap = {
            'draft': '草稿',
            'confirmed': '已确认',
            'in_progress': '开发中',
            'completed': '已完成'
          };
          currentReq.status = statusMap[statusEn] || statusEn;
        }
      }
    }
  } catch (error) {
    console.error('Error reading REQ_REGISTRY.yml:', error.message);
    process.exit(1);
  }

  return reqs;
}

function main() {
  const targetReqId = process.argv[2];

  if (!targetReqId) {
    console.error('Usage: node check-req-status.js <Fxxx>');
    process.exit(1);
  }

  const reqs = parseRequirements();
  if (!reqs) {
    console.log('ℹ️ Requirements tracking not enabled, skipping status check');
    process.exit(0);
  }
  const req = reqs.get(targetReqId);

  if (!req) {
    console.error(`Requirement ${targetReqId} not found in REQ_REGISTRY.yml`);
    process.exit(2);
  }

  // 允许的状态
  const validStatuses = ['已确认', '已完成', '开发中'];

  if (!validStatuses.includes(req.status)) {
    console.error(`Requirement ${targetReqId} status is "${req.status}"`);
    console.error(`Expected: ${validStatuses.join(', ')}`);
    process.exit(2);
  }

  console.log(`✅ Requirement ${targetReqId} status: ${req.status}`);
  process.exit(0);
}

main();
