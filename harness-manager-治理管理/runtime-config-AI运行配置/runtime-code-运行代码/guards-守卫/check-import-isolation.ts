// 检查代码是否违反隔离规则
// 被pre-commit.ts调用

export function checkImportIsolation(content: string): boolean {
  return !content.includes("from '../../../governance/") &&
         !content.includes("from '@/governance/") &&
         !content.includes("from '../../../harness-manager-治理管理/") &&
         !content.includes("from '@/harness-manager-治理管理/");
}
