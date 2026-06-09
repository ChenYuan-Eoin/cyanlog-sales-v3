export function isSchemaDriftError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const maybeError = error as { code?: string; message?: string; details?: string; hint?: string }
  return [
    maybeError.code,
    maybeError.message,
    maybeError.details,
    maybeError.hint,
  ]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => (
      value.includes('does not exist')
      || value.includes('Could not find a relationship')
      || value.includes('schema cache')
      || value.includes('PGRST200')
      || value.includes('42703')
    ))
}
