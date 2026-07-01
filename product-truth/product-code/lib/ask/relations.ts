export type OneOrMany<T> = T | T[] | null | undefined

export function firstRelatedRow<T>(value: OneOrMany<T>): T | null {
  if (Array.isArray(value)) {
    return value[0] || null
  }
  return value || null
}
