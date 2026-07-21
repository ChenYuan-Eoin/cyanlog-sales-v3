type JsonObject = Record<string, unknown>

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/**
 * API routes in this product currently have two compatible error envelopes:
 * `{ error: "..." }` and `{ error: { code, message } }`. UI state must only
 * receive a displayable string; passing the structured object into React
 * crashes the page instead of explaining how the user can recover.
 */
export function clientApiErrorMessage(payload: unknown, fallback: string): string {
  const direct = nonEmptyString(payload)
  if (direct) return direct
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fallback

  const body = payload as JsonObject
  const error = body.error
  const flatError = nonEmptyString(error)
  if (flatError) return flatError
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const nestedMessage = nonEmptyString((error as JsonObject).message)
    if (nestedMessage) return nestedMessage
  }

  return nonEmptyString(body.message) || fallback
}
