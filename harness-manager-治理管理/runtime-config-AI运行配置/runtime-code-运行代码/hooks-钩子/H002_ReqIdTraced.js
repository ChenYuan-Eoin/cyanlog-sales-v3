#!/usr/bin/env node
/**
 * Hook: H002_ReqIdTraced
 * 触发: git pre-commit / pre-tool-use:Write
 * 行为: 检查代码文件头部是否包含 REQ ID 标记
 *
 * 协议:
 *   exit 0 → 放行
 *   exit 2 → 阻止，提示缺少 REQ ID
 */

const fs = require('fs');

// REQ: GOV-H002

const REQ_ID_PATTERN = /REQ:\s*(\w+-\w+-\d+|F\d{3})/;

function extractReqId(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    // 检查前30行
    const lines = content.split('\n').slice(0, 30);

    for (const line of lines) {
      const match = line.match(REQ_ID_PATTERN);
      if (match) return match[1];
    }
    return null;
  } catch (err) {
    return null;
  }
}

function validateReqIdFormat(reqId) {
  // 支持格式:
  // - F001 (业务需求)
  // - GOV-ARCH-001 (治理规则)
  // - GOV-SKL-001 (Skill)
  // - GOV-H00x-001 (Hook)
  // - REQ-POOL-001 (业务文档)
  const validPatterns = [
    /^F\d{3}$/,                        // F001-F999
    /^GOV-[A-Z]+-\d{3}$/,              // GOV-ARCH-001
    /^REQ-[A-Z]+-\d{3}$/,              // REQ-POOL-001
    /^DOC-[A-Z]+-\d{3}$/               // DOC-LOG-001
  ];

  return validPatterns.some(p => p.test(reqId));
}

function main() {
  const targetFile = process.argv[2];

  if (!targetFile) {
    console.error('Usage: node H002_ReqIdTraced.js <file-path>');
    process.exit(1);
  }

  // 只检查代码文件和文档
  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md'];
  const ext = path.extname(targetFile);

  if (!codeExtensions.includes(ext)) {
    process.exit(0);
  }

  // 跳过 node_modules 和 .git
  if (targetFile.includes('node_modules') || targetFile.includes('.git')) {
    process.exit(0);
  }

  const reqId = extractReqId(targetFile);

  if (!reqId) {
    console.error('========================================');
    console.error('❌ H002_ReqIdTraced: 阻止操作');
    console.error('========================================');
    console.error(`文件: ${targetFile}`);
    console.error('');
    console.error('原因: 文件缺少 REQ ID 标记');
    console.error('');
    console.error('解决: 在文件头部添加以下注释之一:');
    console.error('  TypeScript/JS:');
    console.error('    // REQ: F001');
    console.error('  Markdown:');
    console.error('    <!-- REQ: REQ-POOL-001 -->');
    console.error('  JSON (无法注释，跳过此检查):');
    console.error('    在关联的 .ts 文件中标记');
    console.error('');
    console.error('格式要求:');
    console.error('  - 业务需求: F001, F002, ...');
    console.error('  - 治理规则: GOV-ARCH-001, GOV-SKL-001, ...');
    console.error('  - 业务文档: REQ-POOL-001, REQ-PRD-001, ...');
    console.error('========================================');
    process.exit(2);
  }

  if (!validateReqIdFormat(reqId)) {
    console.error('========================================');
    console.error('❌ H002_ReqIdTraced: 阻止操作');
    console.error('========================================');
    console.error(`文件: ${targetFile}`);
    console.error(`REQ ID: ${reqId}`);
    console.error('');
    console.error('原因: REQ ID 格式不正确');
    console.error('');
    console.error('正确格式:');
    console.error('  - F001 (业务需求)');
    console.error('  - GOV-ARCH-001 (治理架构)');
    console.error('  - GOV-SKL-001 (Skill)');
    console.error('  - GOV-H00x-001 (Hook)');
    console.error('  - REQ-POOL-001 (需求池)');
    console.error('========================================');
    process.exit(2);
  }

  console.log(`✅ H002: REQ ID ${reqId} 格式正确，放行`);
  process.exit(0);
}

const path = require('path');
main();
