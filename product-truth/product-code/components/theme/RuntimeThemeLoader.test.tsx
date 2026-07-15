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

describe('RuntimeThemeLoader', () => {
  beforeEach(() => {
    localStorage.clear()
    document.head.querySelectorAll('link[rel*="icon"]').forEach((link) => link.remove())
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
    const serverTheme = sanitizeThemeValue({
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

    localStorage.setItem('token', token)
    localStorage.setItem(`runtime_theme_cache:${suffix}`, JSON.stringify({ theme: cachedTheme, token }))
    localStorage.setItem(`runtime_theme_cache_ts:${suffix}`, String(Date.now()))

    render(createElement(RuntimeThemeLoader, { initialTheme: serverTheme }))

    await waitFor(() => {
      expect(document.documentElement.dataset.brandName).toBe('ONES Sales')
      expect(document.documentElement.dataset.faviconUrl).toContain('/brand/ones-symbol-square.svg')
      expect(document.documentElement.dataset.faviconUrl).not.toContain('stale-favicon')
      expect(localStorage.getItem(`runtime_theme_cache:${suffix}`)).toBeNull()
      expect(localStorage.getItem(`runtime_theme_cache_ts:${suffix}`)).toBeNull()
    })
  })
})
