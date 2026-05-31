// check-req-confirmed.js
// 触发：pre-tool-use:Write 或 git pre-commit
// 检查：编辑文件对应的需求是否已确认

const fs = require('fs');
const {
  isWithinDocument,
  resolveEnabledDocumentPath
} = require('../scripts-脚本/project-registry');

const requirementsDoc = resolveEnabledDocumentPath('requirements');
const REQUIREMENTS_FILE = requirementsDoc ? requirementsDoc.absolutePath : null;

function parseRequirements() {
  if (!REQUIREMENTS_FILE) {
    return null;
  }

  const content = fs.readFileSync(REQUIREMENTS_FILE, 'utf-8');
  const lines = content.split('\n');

  const reqs = [];
  let currentReq = null;

  for (const line of lines) {
    // 匹配需求ID行: F001:
    const idMatch = line.match(/^(F\d{3}):\s*$/);
    if (idMatch) {
      currentReq = { id: idMatch[1], status: null };
      continue;
    }

    // 匹配状态行: status: xxx
    if (currentReq) {
      const statusMatch = line.match(/^\s+status:\s*(\S+)/);
      if (statusMatch) {
        const statusEn = statusMatch[1];
        const statusMap = {
          'draft': '草稿',
          'confirmed': '已确认',
          'in_progress': '开发中',
          'completed': '已完成'
        };
        currentReq.status = statusMap[statusEn] || statusEn;
        reqs.push(currentReq);
        currentReq = null;
      }
    }
  }

  return reqs;
}

function extractReqIdFromFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/REQ:\s*(F\d{3})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function main() {
  const targetFile = process.argv[2];

  if (!targetFile) {
    console.error('Usage: node check-req-confirmed.js <file-path>');
    process.exit(1);
  }

  if (!isWithinDocument(targetFile, 'product-src')) {
    process.exit(0);
  }

  if (!REQUIREMENTS_FILE) {
    console.log('ℹ️ Requirements tracking not enabled, skipping confirmation check');
    process.exit(0);
  }

  const reqId = extractReqIdFromFile(targetFile);

  if (!reqId) {
    console.error(`❌ 阻止操作: ${targetFile}`);
    console.error('   原因: 文件缺少 REQ ID 标记');
    console.error('   解决: 在文件头添加 // REQ:{Fxxx}');
    process.exit(2);
  }

  const reqs = parseRequirements();
  const req = reqs.find(r => r.id === reqId);

  if (!req) {
    console.error(`❌ 阻止操作: ${targetFile}`);
    console.error(`   原因: REQ ID ${reqId} 在 REQ_REGISTRY.yml 中不存在`);
    process.exit(2);
  }

  // 允许编辑的需求状态：已确认、开发中、已完成
  const editableStatuses = ['已确认', '开发中', '已完成'];

  if (!editableStatuses.includes(req.status)) {
    console.error(`❌ 阻止操作: ${targetFile}`);
    console.error(`   原因: 需求 ${reqId} 状态为 "${req.status}"，需要 ${editableStatuses.join('/')}`);
    console.error(`   解决: 先在 REQ_REGISTRY.yml 中将 ${reqId} 状态改为 confirmed/in_progress/completed`);
    process.exit(2);
  }

  console.log(`✅ REQ ${reqId} 已确认，允许操作`);
  process.exit(0);
}

main();
