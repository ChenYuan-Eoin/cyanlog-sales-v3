// 检查需求是否在确认区
// 被pre-commit.ts调用

export function isReqConfirmed(reqId: string, confirmedList: string[]): boolean {
  return confirmedList.includes(reqId);
}
