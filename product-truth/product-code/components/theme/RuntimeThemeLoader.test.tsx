import { createElement } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RuntimeThemeLoader } from './RuntimeThemeLoader'
import { sanitizeThemeValue } from '@/lib/ui-theme-shared'

function stableHash(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}

function createServerTheme() {
  return sanitizeThemeValue({
    brandName: 'ONES Sales',
    faviconUrl: '/brand/ones-symbol-square.svg',
    brandAssets: {
      fullLogo: {
        light: '/brand/ones-logo-horizontal-color.svg',
        dark: '/brand/ones-logo-horizontal-white.svg',
      },
      symbol: {
        light: '/brand/ones-symbol-color.svg',
        dark: '/brand/ones-symbol-white.svg',
      },
      favicon: '/brand/ones-symbol-square.svg',
    },
  })
}

function seedServerBrandDom(theme: ReturnType<typeof sanitizeThemeValue>) {
  document.documentElement.dataset.brandName = theme.brandName
  document.documentElement.dataset.faviconUrl = `/brand/ones-symbol-square.svg?brand_favicon=${stableHash('/brand/ones-symbol-square.svg')}`
  for (const rel of ['icon', 'icon', 'shortcut icon', 'apple-touch-icon']) {
    const link = document.createElement('link')
    link.rel = rel
    link.dataset.runtimeFavicon = 'true'
    link.href = document.documentElement.dataset.faviconUrl
    document.head.appendChild(link)
  }
}

describe('RuntimeThemeLoader', () => {
  beforeEach(() => {
    localStorage.clear()
    document.head.querySelectorAll('link[rel*="icon"]').forEach((link) => link.remove())
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: (callback: IdleRequestCallback) => {
        callback({ didTimeout: false, timeRemaining: () => 50 })
        return 0
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('keeps the server-published theme authoritative over an older browser cache', async () => {
    const token = 'theme-cache-test-token'
    const suffix = stableHash(token)
    const cachedTheme = sanitizeThemeValue({
      brandName: '过期品牌',
      faviconUrl: 'https://cdn.example.com/stale-favicon.png',
      brandAssets: {
        fullLogo: { light: '', dark: '' },
        symbol: { light: '', dark: '' },
        favicon: 'https://cdn.example.com/stale-favicon.png',
      },
    })
    const serverTheme = createServerTheme()

    localStorage.setItem('token', token)
    localStorage.setItem(`runtime_theme_cache:${suffix}`, JSON.stringify({ theme: cachedTheme, token }))
    localStorage.setItem(`runtime_theme_cache_ts:${suffix}`, String(Date.now()))

    // Simulate the server-rendered <html> contract. RuntimeThemeLoader must not
    // rewrite it during hydration when the published theme is already present.
    seedServerBrandDom(serverTheme)

    render(createElement(RuntimeThemeLoader, { initialTheme: serverTheme }))

    await waitFor(() => {
      expect(document.documentElement.dataset.brandName).toBe('ONES Sales')
      expect(document.documentElement.dataset.faviconUrl).toContain('/brand/ones-symbol-square.svg')
      expect(document.documentElement.dataset.faviconUrl).not.toContain('stale-favicon')
      expect(localStorage.getItem(`runtime_theme_cache:${suffix}`)).toBeNull()
      expect(localStorage.getItem(`runtime_theme_cache_ts:${suffix}`)).toBeNull()
    })
  })

  it('does not mutate server favicon nodes when the refreshed theme is unchanged', async () => {
    const token = 'same-theme-test-token'
    const serverTheme = createServerTheme()
    localStorage.setItem('token', token)
    seedServerBrandDom(serverTheme)
    const initialIcons = [...document.head.querySelectorAll('link[rel*="icon"]')]
    const mutations: MutationRecord[] = []
    const observer = new MutationObserver((records) => {
      mutations.push(...records.filter((record) => (
        record.type === 'attributes' || record.target === document.head
      )))
    })
    observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true })
    const runtimeEvents: Event[] = []
    window.addEventListener('runtime-theme-applied', (event) => runtimeEvents.push(event), { once: false })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: 'PUBLISHED', value: serverTheme }] }),
    }))

    render(createElement(RuntimeThemeLoader, { initialTheme: serverTheme }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    observer.disconnect()
    expect(mutations).toHaveLength(0)
    expect(runtimeEvents).toHaveLength(0)
    expect([...document.head.querySelectorAll('link[rel*="icon"]')]).toEqual(initialIcons)
  })
})
