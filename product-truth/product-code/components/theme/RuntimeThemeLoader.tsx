'use client'

import { useEffect } from 'react'

import { resolveFaviconUrl, sanitizeThemeValue, themeToCssVariables } from '@/lib/ui-theme-shared'

// 缓存相关常量
const THEME_CACHE_KEY = 'runtime_theme_cache'
const THEME_CACHE_TIMESTAMP_KEY = 'runtime_theme_cache_ts'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 小时缓存

interface ThemeCache {
  theme: ReturnType<typeof sanitizeThemeValue>
  token: string
}

function getCachedTheme(token: string): ReturnType<typeof sanitizeThemeValue> | null {
  if (typeof window === 'undefined') return null

  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY)
    const timestamp = localStorage.getItem(THEME_CACHE_TIMESTAMP_KEY)

    if (!cached || !timestamp) return null

    // 检查缓存是否过期
    const now = Date.now()
    const cachedTime = parseInt(timestamp, 10)
    if (now - cachedTime > CACHE_TTL_MS) {
      // 缓存过期，清理
      localStorage.removeItem(THEME_CACHE_KEY)
      localStorage.removeItem(THEME_CACHE_TIMESTAMP_KEY)
      return null
    }

    const cacheData: ThemeCache = JSON.parse(cached)

    // 检查 token 是否匹配（防止切换用户后使用错误的主题）
    if (cacheData.token !== token) {
      return null
    }

    return cacheData.theme
  } catch {
    // 缓存解析失败，清理
    localStorage.removeItem(THEME_CACHE_KEY)
    localStorage.removeItem(THEME_CACHE_TIMESTAMP_KEY)
    return null
  }
}

function setCachedTheme(theme: ReturnType<typeof sanitizeThemeValue>, token: string): void {
  if (typeof window === 'undefined') return

  try {
    const cacheData: ThemeCache = { theme, token }
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(cacheData))
    localStorage.setItem(THEME_CACHE_TIMESTAMP_KEY, String(Date.now()))
  } catch {
    // 存储失败（如 localStorage 已满），静默忽略
  }
}

function applyTheme(theme: ReturnType<typeof sanitizeThemeValue>): void {
  const variables = themeToCssVariables(theme)

  Object.entries(variables).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value)
  })

  document.documentElement.dataset.brandName = theme.brandName
  document.documentElement.dataset.brandShortName = theme.brandShortName
  document.documentElement.dataset.logoUrl = theme.logoUrl

  if (theme.productTitle) {
    document.title = theme.productTitle
  }

  const faviconUrl = resolveFaviconUrl(theme)
  if (faviconUrl) {
    const rels = ['icon', 'shortcut icon', 'apple-touch-icon']
    rels.forEach((rel) => {
      let link = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null
      if (!link) {
        link = document.createElement('link')
        link.rel = rel
        document.head.appendChild(link)
      }
      link.href = faviconUrl
    })
  }

  // 同步到全局，供 BrandingProvider 读取（brandAssets 等复杂对象无法通过 DOM 属性传递）
  if (typeof window !== 'undefined') {
    ;(window as unknown as Record<string, unknown>).__RUNTIME_THEME__ = theme
    window.dispatchEvent(new CustomEvent('runtime-theme-applied', { detail: theme }))
  }
}

export function RuntimeThemeLoader() {
  useEffect(() => {
    let cancelled = false

    async function loadTheme() {
      const token = window.localStorage.getItem('token')
      if (!token) {
        return
      }

      // 首先尝试从缓存加载主题，避免网络请求
      const cachedTheme = getCachedTheme(token)
      if (cachedTheme) {
        applyTheme(cachedTheme)
        // 缓存已应用，但仍需在后台刷新以获取最新主题
        // 不 return，继续执行 fetch
      }

      try {
        const response = await fetch('/api/configs?type=UI_THEME', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        if (!response.ok) {
          return
        }

        const configs = await response.json() as Array<{ value?: Record<string, unknown>; status?: string; updated_at?: string }>
        // 优先使用已发布配置，如果没有则使用最新更新的配置
        const publishedConfig = configs.find(c => c.status === 'PUBLISHED')
        const latestConfig = configs.sort((a, b) =>
          new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
        )[0]
        const themeConfig = publishedConfig || latestConfig
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
      }
    }

    void loadTheme()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
