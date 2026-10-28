export const ADDRESS_DETAIL_REQUIRED = '请补充具体投递地点，如村庄、园区、楼宇或门牌号'

// A named destination can be deliverable without a numeric house number. This
// checks supplied detail only; carrier coverage is determined at order review.
const namedDestination = /[\p{L}\d]+(?:村|屯|庄|寨|社区|小区|园|园区|营区|基地|部队|大厦|写字楼|中心|仓库|学校|大学|医院|码头|车站|公司|工厂)/u
const vagueDestination = /(?:附近|周边|一带|待补充|待定|不详|未知|联系后告知|电话联系)$/u

export function addressDetailError(value: string): string | null {
  const detail = value.trim()
  if (!detail || vagueDestination.test(detail)) return ADDRESS_DETAIL_REQUIRED
  if (namedDestination.test(detail)) return null
  // Preserve existing numbered street/building formats, including Chinese numerals.
  if (detail.length >= 5 && /\d|[一二三四五六七八九十百]+(?:号|栋|幢|楼|室)/u.test(detail)) return null
  return ADDRESS_DETAIL_REQUIRED
}
