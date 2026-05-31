#!/usr/bin/env node
/**
 * Hook: H003_IsolationCheck
 * 触发: git pre-commit
 * 行为: 检查 product/ 目录下文件是否违规引用 governance/
 *
 * 原则: 治理层和业务层必须物理隔离，不能互相导入
 *
 * 协议:
 *   exit 0 → 放行
 *   exit 2 → 阻止，提示违规引用
 */

const fs = require('fs');
const { isWithinDocument } = require('../scripts-脚本/project-registry');

// REQ: GOV-H003

// 检测模式
const VIOLATION_PATTERNS = [
  // ES6 import from governance
  /import\s+.*?\s+from\s+['"]\.\.\/(governance|harness-manager-治理管理)\//,
  /import\s+.*?\s+from\s+['"](governance|harness-manager-治理管理)\//,

  // CommonJS require governance
  /require\(['"]\.\.\/(governance|harness-manager-治理管理)\//,
  /require\(['"](governance|harness-manager-治理管理)\//,

  // 动态 import
  /import\(['"]\.\.\/(governance|harness-manager-治理管理)\//,
  /import\(['"](governance|harness-manager-治理管理)\//,

  // 相对路径跨越到 governance
  /from\s+['"](\.\.\/)+((governance)|(harness-manager-治理管理))\//,
];

function checkImportIsolation(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const violations = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      for (const pattern of VIOLATION_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({ line: lineNum, code: line.trim() });
        }
      }
    }

    return {
      ok: violations.length === 0,
      violations
    };
  } catch (err) {
    // 无法读取的文件视为通过
    return { ok: true, violations: [] };
  }
}

function main() {
  const targetFile = process.argv[2];

  if (!targetFile) {
    console.error('Usage: node H003_IsolationCheck.js <file-path>');
    process.exit(1);
  }

  if (!isWithinDocument(targetFile, 'product-src')) {
    process.exit(0);
  }

  const result = checkImportIsolation(targetFile);

  if (!result.ok) {
    console.error('========================================');
    console.error('❌ H003_IsolationCheck: 阻止提交');
    console.error('========================================');
    console.error(`文件: ${targetFile}`);
    console.error('');
    console.error('原因: 检测到违规引用治理层目录');
    console.error('');
    console.error('违规位置:');
    for (const v of result.violations) {
      console.error(`  第 ${v.line} 行: ${v.code}`);
    }
    console.error('');
    console.error('治理规则:');
    console.error('  产品开发层（业务代码）');
    console.error('  治理层（治理规则）');
    console.error('  必须物理隔离，禁止互相导入');
    console.error('');
    console.error('解决:');
    console.error('  1. 如需使用治理层工具，复制相关代码到产品层自有目录');
    console.error('  2. 或通过 API 接口调用（HTTP/gRPC）');
    console.error('  3. 取消引用治理层的代码');
    console.error('========================================');
    process.exit(2);
  }

  console.log('✅ H003: 无违规引用，放行');
  process.exit(0);
}

main();
