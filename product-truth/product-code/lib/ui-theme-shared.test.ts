import { describe, expect, it } from 'vitest'

import { DEFAULT_THEME, resolveBrandImageUrl, resolveFaviconUrl, sanitizeThemeValue } from './ui-theme-shared'

describe('ui-theme-shared helpers', () => {
  it('prefers new brandAssets favicon over legacy faviconUrl', () => {
    const theme = sanitizeThemeValue({
      ...DEFAULT_THEME,
      brandAssets: {
        ...DEFAULT_THEME.brandAssets,
        favicon: 'https://cdn.example.com/new-favicon.png',
      },
      faviconUrl: 'https://cdn.example.com/legacy-favicon.ico',
    })

    expect(resolveFaviconUrl(theme)).toBe('https://cdn.example.com/new-favicon.png')
  })

  it('falls back from symbol asset to full logo when symbol is missing', () => {
    const theme = sanitizeThemeValue({
      ...DEFAULT_THEME,
      brandAssets: {
        fullLogo: {
          light: 'https://cdn.example.com/full-light.svg',
          dark: 'https://cdn.example.com/full-dark.svg',
        },
        symbol: {
          light: '',
          dark: '',
        },
        favicon: '',
      },
    })

    expect(resolveBrandImageUrl(theme, 'symbol', 'dark')).toBe('https://cdn.example.com/full-dark.svg')
    expect(resolveBrandImageUrl(theme, 'symbol', 'light')).toBe('https://cdn.example.com/full-light.svg')
  })

  it('falls back from missing favicon to the runtime brand symbol', () => {
    const theme = sanitizeThemeValue({
      ...DEFAULT_THEME,
      faviconUrl: '',
      logoUrl: '',
      brandAssets: {
        fullLogo: {
          light: 'https://cdn.example.com/full-light.svg',
          dark: 'https://cdn.example.com/full-dark.svg',
        },
        symbol: {
          light: 'https://cdn.example.com/symbol-light.svg',
          dark: 'https://cdn.example.com/symbol-dark.svg',
        },
        favicon: '',
      },
    })

    expect(resolveFaviconUrl(theme)).toBe('https://cdn.example.com/symbol-dark.svg')
  })
})
