// check-import-isolation.js
// 触发：pre-commit
// 检查：产品开发层代码不引用治理层目录

const fs = require('fs');
const { isWithinDocument } = require('../scripts-脚本/project-registry');

function checkFileImports(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    const governanceImport = /import.*from\s+['"](governance|harness-manager-治理管理)\//;
    const governanceRequire = /require\(['"](governance|harness-manager-治理管理)\//;

    if (governanceImport.test(content) || governanceRequire.test(content)) {
      return {
        ok: false,
        reason: `文件包含 governance/ 引用`
      };
    }

    if (isWithinDocument(filePath, 'product-src')) {
      const governanceRelative = /import.*from\s+['"](\.\.\/)+((governance)|(harness-manager-治理管理))\//;
      if (governanceRelative.test(content)) {
        return {
          ok: false,
          reason: `产品开发层文件违规引用治理层目录`
        };
      }
    }

    return { ok: true };
  } catch {
    return { ok: true };
  }
}

function main() {
  const targetFile = process.argv[2];

  if (!targetFile) {
    console.error('Usage: node check-import-isolation.js <file-path>');
    process.exit(1);
  }

  const result = checkFileImports(targetFile);

  if (!result.ok) {
    console.error(`❌ 阻止操作: ${targetFile}`);
    console.error(`   原因: ${result.reason}`);
    console.error('   治理规则: 产品开发层和治理层必须物理隔离');
    console.error('   解决: 移除治理层引用，改为复制必要逻辑或通过明确接口调用');
    process.exit(2);
  }

  process.exit(0);
}

main();
