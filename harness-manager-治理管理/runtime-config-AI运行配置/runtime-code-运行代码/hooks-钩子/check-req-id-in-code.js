// REQ:GOV-H002
// PURPOSE: 检查文件是否包含有效的 REQ ID 标记
// 触发: pre-tool-use:Write, git pre-commit

const fs = require('fs');
const {
  isWithinDocument,
  resolveEnabledDocumentPath
} = require('../scripts-脚本/project-registry');

const requirementsDoc = resolveEnabledDocumentPath('requirements');
const REQUIREMENTS_FILE = requirementsDoc ? requirementsDoc.absolutePath : null;

/**
 * 解析 REQ_REGISTRY.yml 获取所有有效 REQ ID
 */
function parseValidReqIds() {
  if (!REQUIREMENTS_FILE) {
    return null;
  }

  try {
    const content = fs.readFileSync(REQUIREMENTS_FILE, 'utf-8');
    const reqIds = new Set();

    // 匹配 YAML 中的 Fxxx: 格式
    const regex = /^(F\d{3}):\s*$/gm;
    let match;

    while ((match = regex.exec(content)) !== null) {
      reqIds.add(match[1]);
    }

    return reqIds;
  } catch (error) {
    console.error('❌ Error reading REQ_REGISTRY.yml:', error.message);
    return new Set();
  }
}

/**
 * 从文件内容提取 REQ ID
 */
function extractReqId(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // 检查文件头注释
    const headerMatch = content.match(/REQ:\s*(F\d{3})/);
    if (headerMatch) {
      return headerMatch[1];
    }

    // 检查 JSDoc 风格
    const jsdocMatch = content.match(/@REQ\s+(F\d{3})/);
    if (jsdocMatch) {
      return jsdocMatch[1];
    }

    return null;
  } catch (error) {
    console.error(`❌ Error reading file ${filePath}:`, error.message);
    return null;
  }
}

/**
 * 检查文件是否需要 REQ ID
 */
function needsReqId(filePath) {
  if (!isWithinDocument(filePath, 'product-src')) {
    return false;
  }

  // 排除测试文件
  if (filePath.includes('.test.') || filePath.includes('.spec.')) {
    return false;
  }

  // 排除类型定义文件
  if (filePath.endsWith('.d.ts')) {
    return false;
  }

  // 只检查这些扩展名
  const validExts = ['.ts', '.tsx', '.js', '.jsx'];
  return validExts.some(ext => filePath.endsWith(ext));
}

function main() {
  const targetFile = process.argv[2];

  if (!targetFile) {
    console.error('Usage: node check-req-id-in-code.js <file-path>');
    process.exit(1);
  }

  if (!REQUIREMENTS_FILE) {
    console.log('ℹ️ Requirements tracking not enabled, skipping REQ ID validation');
    process.exit(0);
  }

  // 检查是否需要 REQ ID
  if (!needsReqId(targetFile)) {
    console.log(`ℹ️  ${targetFile} does not require REQ ID`);
    process.exit(0);
  }

  const reqId = extractReqId(targetFile);

  if (!reqId) {
    console.error('');
    console.error('❌ 阻止操作: 文件缺少 REQ ID 标记');
    console.error(`   文件: ${targetFile}`);
    console.error('');
    console.error('   请在文件开头添加以下注释:');
    console.error('   // REQ:F001');
    console.error('');
    console.error('   参考: product-truth-产品真相层/REQ_REGISTRY.yml');
    console.error('');
    process.exit(2);
  }

  // 验证 REQ ID 是否有效
  const validReqIds = parseValidReqIds();

  if (!validReqIds.has(reqId)) {
    console.error('');
    console.error('❌ 阻止操作: 无效的 REQ ID');
    console.error(`   文件: ${targetFile}`);
    console.error(`   发现的 REQ ID: ${reqId}`);
    console.error('');
    console.error('   该 REQ ID 在 REQ_REGISTRY.yml 中不存在');
    console.error('   请检查拼写，或先在 REQ_REGISTRY.yml 中添加该需求');
    console.error('');
    process.exit(2);
  }

  console.log(`✅ REQ ID ${reqId} 有效`);
  process.exit(0);
}

main();
