const INTERNAL_ORIGIN = 'https://icu.internal'
const NON_BUSINESS_PATH = /^(?:\/api|\/_next|\/login|\/accept-invitation)(?:\/|$)/i

export function fxiaokeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1024 || !value.startsWith('/') || value.startsWith('//')
    || /[\\\p{Cc} ]/u.test(value)) return null

  try {
    const url = new URL(value, INTERNAL_ORIGIN)
    const pathname = decodeURIComponent(url.pathname)
    if (url.origin !== INTERNAL_ORIGIN || pathname.startsWith('//')
      || /[\\\p{Cc}]/u.test(pathname) || NON_BUSINESS_PATH.test(pathname)) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}
