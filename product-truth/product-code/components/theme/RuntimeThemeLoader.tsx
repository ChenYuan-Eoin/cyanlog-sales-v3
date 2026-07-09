'use client'

import { useEffect } from 'react'

import { DEFAULT_THEME, resolveBrandImageUrl, resolveFaviconUrl, sanitizeThemeValue, themeToCssVariables } from '@/lib/ui-theme-shared'

// 缓存相关常量
const THEME_CACHE_KEY = 'runtime_theme_cache'
const THEME_CACHE_TIMESTAMP_KEY = 'runtime_theme_cache_ts'
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_REFRESH_INTERVAL_MS = 30 * 1000
const BACKGROUND_REFRESH_DELAY_MS = 2_000
const BACKGROUND_REFRESH_TIMEOUT_MS = 4_000

let lastRefreshAttemptAt = 0

interface ThemeCache {
  theme: ReturnType<typeof sanitizeThemeValue>
  token: string
}

type CachedThemeEntry = {
  theme: ReturnType<typeof sanitizeThemeValue>
  ageMs: number
}

function stableHash(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}

function tokenScopedCacheKey(key: string, token: string) {
  return `${key}:${stableHash(token)}`
}

function getCachedTheme(token: string): CachedThemeEntry | null {
  if (typeof window === 'undefined') return null

  try {
    const scopedThemeKey = tokenScopedCacheKey(THEME_CACHE_KEY, token)
    const scopedTimestampKey = tokenScopedCacheKey(THEME_CACHE_TIMESTAMP_KEY, token)
    const cached = localStorage.getItem(scopedThemeKey)
    const timestamp = localStorage.getItem(scopedTimestampKey)

    if (!cached || !timestamp) return null

    // 检查缓存是否过期
    const now = Date.now()
    const cachedTime = parseInt(timestamp, 10)
    if (now - cachedTime > CACHE_TTL_MS) {
      // 缓存过期，清理
      localStorage.removeItem(scopedThemeKey)
      localStorage.removeItem(scopedTimestampKey)
      return null
    }

    const cacheData: ThemeCache = JSON.parse(cached)

    // 检查 token 是否匹配（防止切换用户后使用错误的主题）
    if (cacheData.token !== token) {
      return null
    }

    return {
      theme: cacheData.theme,
      ageMs: now - cachedTime,
    }
  } catch {
    // 缓存解析失败，清理
    localStorage.removeItem(tokenScopedCacheKey(THEME_CACHE_KEY, token))
    localStorage.removeItem(tokenScopedCacheKey(THEME_CACHE_TIMESTAMP_KEY, token))
    return null
  }
}

function setCachedTheme(theme: ReturnType<typeof sanitizeThemeValue>, token: string): void {
  if (typeof window === 'undefined') return

  try {
    const cacheData: ThemeCache = { theme, token }
    localStorage.setItem(tokenScopedCacheKey(THEME_CACHE_KEY, token), JSON.stringify(cacheData))
    localStorage.setItem(tokenScopedCacheKey(THEME_CACHE_TIMESTAMP_KEY, token), String(Date.now()))
  } catch {
    // 存储失败（如 localStorage 已满），静默忽略
  }
}

function clearCachedTheme(token: string): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.removeItem(tokenScopedCacheKey(THEME_CACHE_KEY, token))
    localStorage.removeItem(tokenScopedCacheKey(THEME_CACHE_TIMESTAMP_KEY, token))
  } catch {
    // 缓存清理失败不能阻塞默认主题回退。
  }
}

function withRuntimeFaviconVersion(url: string) {
  try {
    const parsed = new URL(url, window.location.origin)
    parsed.searchParams.set('brand_favicon', stableHash(url))
    return parsed.toString()
  } catch {
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}brand_favicon=${stableHash(url)}`
  }
}

function applyTheme(theme: ReturnType<typeof sanitizeThemeValue>): void {
  const variables = themeToCssVariables(theme)

  Object.entries(variables).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value)
  })

  document.documentElement.dataset.brandName = theme.brandName
  document.documentElement.dataset.brandShortName = theme.brandShortName
  document.documentElement.dataset.logoUrl = resolveBrandImageUrl(theme, 'full', 'dark') || resolveBrandImageUrl(theme, 'symbol', 'dark')
  document.documentElement.dataset.productTitle = theme.productTitle

  if (theme.productTitle) {
    document.title = theme.productTitle
  }

  const faviconUrl = resolveFaviconUrl(theme)
  if (faviconUrl) {
    const versionedFaviconUrl = withRuntimeFaviconVersion(faviconUrl)
    document.documentElement.dataset.faviconUrl = versionedFaviconUrl
    const rels = ['icon', 'shortcut icon', 'apple-touch-icon']
    document.head
      .querySelectorAll<HTMLLinkElement>('link[rel*="icon"]')
      .forEach((link) => {
        link.remove()
      })
    rels.forEach((rel) => {
      const link = document.createElement('link')
      link.rel = rel
      link.dataset.runtimeFavicon = 'true'
      link.href = versionedFaviconUrl
      const isSvg = faviconUrl.toLowerCase().includes('.svg')
      link.type = isSvg ? 'image/svg+xml' : 'image/png'
      document.head.appendChild(link)
    })
  }

  // 同步到全局，供 BrandingProvider 读取（brandAssets 等复杂对象无法通过 DOM 属性传递）
  if (typeof window !== 'undefined') {
    ;(window as unknown as Record<string, unknown>).__RUNTIME_THEME__ = theme
    window.dispatchEvent(new CustomEvent('runtime-theme-applied', { detail: theme }))
  }
}

function isDefaultBrandProfile(theme: ReturnType<typeof sanitizeThemeValue>) {
  return theme.brandName === DEFAULT_THEME.brandName
    && theme.productTitle === DEFAULT_THEME.productTitle
    && resolveFaviconUrl(theme) === resolveFaviconUrl(DEFAULT_THEME)
}

function scheduleBackgroundRefresh(callback: () => void) {
  const idle = window.requestIdleCallback
  if (idle) {
    idle(callback, { timeout: BACKGROUND_REFRESH_DELAY_MS })
    return
  }
  window.setTimeout(callback, BACKGROUND_REFRESH_DELAY_MS)
}

export function RuntimeThemeLoader({
  initialTheme,
}: {
  initialTheme?: ReturnType<typeof sanitizeThemeValue>
}) {
  useEffect(() => {
    let cancelled = false
    if (initialTheme) {
      applyTheme(initialTheme)
    }

    async function loadTheme() {
      const token = window.localStorage.getItem('token')
      if (!token) {
        return
      }

      const shouldUseCache = !initialTheme || !isDefaultBrandProfile(initialTheme)
      if (!shouldUseCache) {
        clearCachedTheme(token)
      }

      // 首先尝试从缓存加载主题，避免网络请求；默认主题不允许被历史缓存覆盖。
      const cachedTheme = shouldUseCache ? getCachedTheme(token) : null
      if (cachedTheme) {
        applyTheme(cachedTheme.theme)
      }

      const refreshTheme = async () => {
        const now = Date.now()
        if (cachedTheme && now - lastRefreshAttemptAt < CACHE_REFRESH_INTERVAL_MS) {
          return
        }
        lastRefreshAttemptAt = now
        const controller = new AbortController()
        const timeout = window.setTimeout(() => {
          controller.abort()
        }, BACKGROUND_REFRESH_TIMEOUT_MS)

        try {
          const response = await fetch('/api/configs?type=UI_THEME&status=PUBLISHED&limit=10', {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            signal: controller.signal,
          })

          if (!response.ok) {
            return
          }

          const payload = await response.json() as
            | { data?: Array<{ value?: Record<string, unknown>; status?: string; updated_at?: string }> }
            | Array<{ value?: Record<string, unknown>; status?: string; updated_at?: string }>
          const configs = Array.isArray(payload) ? payload : (payload.data || [])
          const sortedConfigs = [...configs].sort((a, b) =>
            new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
          )
          // Runtime only applies the current published BrandProfile. Draft themes stay editable
          // in config center but must not unexpectedly change favicon/logo/title.
          const themeConfig = sortedConfigs.find(c => c.status === 'PUBLISHED')
          if (!themeConfig) {
            clearCachedTheme(token)
            applyTheme(initialTheme || DEFAULT_THEME)
            return
          }
          const theme = sanitizeThemeValue(themeConfig?.value)

          if (cancelled) {
            return
          }

          // 应用主题
          applyTheme(theme)

          // 更新缓存
          setCachedTheme(theme, token)
        } catch {
          // 忽略运行时主题失败，保持默认值或缓存值
        } finally {
          window.clearTimeout(timeout)
        }
      }

      if (cachedTheme) {
        scheduleBackgroundRefresh(() => {
          void refreshTheme()
        })
        return
      }

      void refreshTheme()
    }

    void loadTheme()

    return () => {
      cancelled = true
    }
  }, [initialTheme])

  return null
}
