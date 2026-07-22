interface StructuredApiError {
  error?: string | { message?: string }
  message?: string
}

export function uploadErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback

  const candidate = payload as StructuredApiError
  if (typeof candidate.error === 'string' && candidate.error.trim()) {
    return candidate.error
  }
  if (
    candidate.error
    && typeof candidate.error === 'object'
    && typeof candidate.error.message === 'string'
    && candidate.error.message.trim()
  ) {
    return candidate.error.message
  }
  if (typeof candidate.message === 'string' && candidate.message.trim()) {
    return candidate.message
  }

  return fallback
}

export async function readUploadErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    return uploadErrorMessage(await response.json(), fallback)
  } catch {
    return fallback
  }
}
