export function normalizeOpenAICompatibleBaseUrl(baseUrl: string | undefined | null): string {
  const trimmed = baseUrl?.trim() || ''
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed)
    const path = url.pathname.replace(/\/+$/, '')
    if (!path) {
      url.pathname = '/v1'
      url.search = ''
      url.hash = ''
      return url.toString().replace(/\/$/, '')
    }
    return trimmed.replace(/\/+$/, '')
  } catch {
    return trimmed
  }
}

export function openAICompatibleModelsUrl(baseUrl: string): URL {
  const normalized = normalizeOpenAICompatibleBaseUrl(baseUrl)
  const base = normalized.endsWith('/') ? normalized : `${normalized}/`
  return new URL('models', base)
}
