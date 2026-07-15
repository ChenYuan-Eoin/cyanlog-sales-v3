import { describe, expect, it } from 'vitest'

import {
  DEFAULT_THEME,
  OFFICIAL_FAVICON_SVG,
  isOfficialFaviconUrl,
  resolveBrandImageUrl,
  resolveFaviconUrl,
  sanitizeThemeValue,
} from './ui-theme-shared'

describe('ui-theme-shared helpers', () => {
  it('uses official ONES assets without forcing source logos into square containers', () => {
    expect(DEFAULT_THEME.brandAssets.fullLogo.light).toBe('/brand/ones-logo-horizontal-color.svg')
    expect(DEFAULT_THEME.brandAssets.fullLogo.dark).toBe('/brand/ones-logo-horizontal-white.svg')
    expect(DEFAULT_THEME.brandAssets.symbol.light).toBe('/brand/ones-symbol-color.svg')
    expect(DEFAULT_THEME.brandAssets.symbol.dark).toBe('/brand/ones-symbol-white.svg')
    expect(DEFAULT_THEME.brandAssets.favicon).toBe(OFFICIAL_FAVICON_SVG)
    expect(isOfficialFaviconUrl(`https://sales.cyanlog.icu${OFFICIAL_FAVICON_SVG}?v=1`)).toBe(true)
  })

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
