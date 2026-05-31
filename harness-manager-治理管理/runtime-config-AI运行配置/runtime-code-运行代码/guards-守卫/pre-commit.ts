#!/usr/bin/env tsx
// ⚠️ LEGACY: 此脚本已弃用，由 hooks-钩子/pre-commit 取代
// 保留仅作参考，不纳入 active hook 路径

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

// 读取确认区需求 (旧格式 REQUIREMENTS.md - 已弃用)
function getConfirmedReqs(): string[] {
  console.warn('⚠️ 使用遗留脚本，不读取 REQ_REGISTRY.yml');
  return [];
}

// 检查代码文件追溯
function checkCodeTrace(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf8');
  return content.includes('// REQ:');
}

// 检查隔离
function checkIsolation(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf8');
  return !content.includes("from '../../../governance/") &&
         !content.includes("from '../../../harness-manager-治理管理/") &&
         !content.includes("from '@/governance/") &&
         !content.includes("from '@/harness-manager-治理管理/");
}

// 获取所有ts文件
function getTsFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const items = readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const path = join(dir, item.name);
      if (item.isDirectory()) {
        files.push(...getTsFiles(path));
      } else if (
        (item.name.endsWith('.ts') || item.name.endsWith('.tsx')) &&
        !item.name.endsWith('.test.ts') &&
        !item.name.endsWith('.spec.ts') &&
        !item.name.endsWith('.d.ts')
      ) {
        files.push(path);
      }
    }
  } catch {}
  return files;
}

// 主检查
async function main() {
  const requirementsPath = join(ROOT, 'product-truth-产品真相层/prd-产品需求文档/REQUIREMENTS.md');
  const requirementsEnabled = existsSync(requirementsPath);
  const confirmedReqs = getConfirmedReqs();
  const productSrc = join(ROOT, 'cyanlog-sales-v3');

  if (!existsSync(productSrc)) {
    console.log('ℹ️ 产品开发层目录未启用，跳过治理检查');
    process.exit(0);
  }

  const files = getTsFiles(productSrc);

  let failed = false;

  for (const file of files) {
    // R002
    if (requirementsEnabled && !checkCodeTrace(file)) {
      console.error(`❌ ${file}: 缺少 // REQ: 追溯注释`);
      failed = true;
    }

    // R003
    if (!checkIsolation(file)) {
      console.error(`❌ ${file}: 违反隔离规则，引用了governance/`);
      failed = true;
    }

    // 提取REQ ID检查R001
    const content = readFileSync(file, 'utf8');
    const reqMatch = content.match(/\/\/ REQ:\s*(F\d{3})/);
    if (requirementsEnabled && reqMatch && !confirmedReqs.includes(reqMatch[1])) {
      console.error(`❌ ${file}: ${reqMatch[1]} 未在确认区`);
      failed = true;
    }
  }

  if (failed) {
    console.error('\n治理检查失败，提交被阻止');
    process.exit(1);
  }

  console.log('✅ 治理检查通过');
}

main();
