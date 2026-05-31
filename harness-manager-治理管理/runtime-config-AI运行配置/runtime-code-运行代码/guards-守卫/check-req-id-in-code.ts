// 检查代码文件是否有REQ追溯注释
// 被pre-commit.ts调用

export function hasReqIdInCode(content: string): { has: boolean; id?: string } {
  const match = content.match(/\/\/ REQ:\s*(F\d{3})/);
  return match ? { has: true, id: match[1] } : { has: false };
}
