// 品牌资产定义
export interface BrandAssets {
  // 完整 Logo（图标+文字）
  fullLogo: {
    light: string  // 用于浅色背景
    dark: string   // 用于深色背景
  }
  // 图标符号（保持品牌原比例，用于折叠态；容器负责 contain）
  symbol: {
    light: string
    dark: string
  }
  // 浏览器图标
  favicon: string
}

// 容器规则（固定值，用户不可配置）
export const LOGO_CONTAINER = {
  height: 48,        // 侧边栏固定48px
  maxLogoHeight: 28, // Logo最大28px（留白）
  padding: 16,       // 左右内边距
} as const

export type AppearanceMode = 'system' | 'light' | 'dark'

export interface UIThemeConfigValue {
  brandName?: string
  brandShortName?: string
  productTitle?: string
  productSubtitle?: string
  loginTitle?: string
  loginSubtitle?: string

  // 新品牌资产配置（替代旧 logoUrl/faviconUrl）
  brandAssets?: BrandAssets

  // 主题外观模式
  appearance?: AppearanceMode

  // 旧字段保留（兼容过渡，优先使用 brandAssets）
  logoUrl?: string
  faviconUrl?: string

  primary?: string
  primaryForeground?: string
  secondary?: string
  secondaryForeground?: string
  background?: string
  foreground?: string
  card?: string
  cardForeground?: string
  popover?: string
  popoverForeground?: string
  muted?: string
  mutedForeground?: string
  border?: string
  input?: string
  ring?: string
  destructive?: string
  destructiveForeground?: string
  radiusMd?: number
  radiusLg?: number
}

export type BrandAssetVariant = 'full' | 'symbol'
export type BrandSurfaceTone = 'light' | 'dark'

export const BRAND_ASSET_VERSION = '20260715-p1'
export const OFFICIAL_FAVICON_SVG = '/brand/ones-symbol-square.svg'
export const OFFICIAL_FAVICON_PNG_32 = '/brand/ones-symbol-square-32.png'
export const OFFICIAL_APPLE_TOUCH_ICON = '/brand/ones-symbol-square-180.png'

export function isOfficialFaviconUrl(url: string): boolean {
  return url.split(/[?#]/, 1)[0]?.endsWith(OFFICIAL_FAVICON_SVG) ?? false
}

export const DEFAULT_THEME: Required<UIThemeConfigValue> = {
  brandName: 'ONES Sales',
  brandShortName: 'OS',
  productTitle: 'ONES Sales',
  productSubtitle: '智能协作平台',
  loginTitle: '企业协作支撑平台',
  loginSubtitle: '使用企业账号进入工作台首页',

  // 新品牌资产配置
  brandAssets: {
    fullLogo: {
      light: '/brand/ones-logo-horizontal-color.svg',
      dark: '/brand/ones-logo-horizontal-white.svg',
    },
    symbol: {
      light: '/brand/ones-symbol-color.svg',
      dark: '/brand/ones-symbol-white.svg',
    },
    favicon: OFFICIAL_FAVICON_SVG,
  },

  // 默认跟随系统
  appearance: 'system',

  // 旧字段（过渡兼容）
  logoUrl: '/brand/ones-logo-horizontal-white.svg',
  faviconUrl: OFFICIAL_FAVICON_SVG,

  primary: '#2563eb',
  primaryForeground: '#ffffff',
  secondary: '#eff6ff',
  secondaryForeground: '#0f172a',
  background: '#eef3f8',
  foreground: '#0f172a',
  card: '#ffffff',
  cardForeground: '#0f172a',
  popover: '#ffffff',
  popoverForeground: '#0f172a',
  muted: '#f8fafc',
  mutedForeground: '#64748b',
  border: '#dbe4ee',
  input: '#ffffff',
  ring: '#60a5fa',
  destructive: '#dc2626',
  destructiveForeground: '#ffffff',
  radiusMd: 10,
  radiusLg: 16,
}

export function sanitizeThemeValue(value: Record<string, unknown> | null | undefined): Required<UIThemeConfigValue> {
  const theme = value ?? {}

  return {
    brandName: pickText(theme.brandName, DEFAULT_THEME.brandName),
    brandShortName: pickText(theme.brandShortName, DEFAULT_THEME.brandShortName),
    productTitle: pickText(theme.productTitle, DEFAULT_THEME.productTitle),
    productSubtitle: pickText(theme.productSubtitle, DEFAULT_THEME.productSubtitle),
    loginTitle: pickText(theme.loginTitle, DEFAULT_THEME.loginTitle),
    loginSubtitle: pickText(theme.loginSubtitle, DEFAULT_THEME.loginSubtitle),

    // 新品牌资产配置
    brandAssets: pickBrandAssets(theme.brandAssets),
    appearance: pickAppearance(theme.appearance),

    // 旧字段兼容
    logoUrl: pickOptionalText(theme.logoUrl),
    faviconUrl: pickOptionalText(theme.faviconUrl),

    primary: pickColor(theme.primary, DEFAULT_THEME.primary),
    primaryForeground: pickColor(theme.primaryForeground, DEFAULT_THEME.primaryForeground),
    secondary: pickColor(theme.secondary, DEFAULT_THEME.secondary),
    secondaryForeground: pickColor(theme.secondaryForeground, DEFAULT_THEME.secondaryForeground),
    background: pickColor(theme.background, DEFAULT_THEME.background),
    foreground: pickColor(theme.foreground, DEFAULT_THEME.foreground),
    card: pickColor(theme.card, DEFAULT_THEME.card),
    cardForeground: pickColor(theme.cardForeground, DEFAULT_THEME.cardForeground),
    popover: pickColor(theme.popover, DEFAULT_THEME.popover),
    popoverForeground: pickColor(theme.popoverForeground, DEFAULT_THEME.popoverForeground),
    muted: pickColor(theme.muted, DEFAULT_THEME.muted),
    mutedForeground: pickColor(theme.mutedForeground, DEFAULT_THEME.mutedForeground),
    border: pickColor(theme.border, DEFAULT_THEME.border),
    input: pickColor(theme.input, DEFAULT_THEME.input),
    ring: pickColor(theme.ring, DEFAULT_THEME.ring),
    destructive: pickColor(theme.destructive, DEFAULT_THEME.destructive),
    destructiveForeground: pickColor(theme.destructiveForeground, DEFAULT_THEME.destructiveForeground),
    radiusMd: pickRadius(theme.radiusMd, DEFAULT_THEME.radiusMd),
    radiusLg: pickRadius(theme.radiusLg, DEFAULT_THEME.radiusLg),
  }
}

export function resolveBrandImageUrl(
  theme: Required<UIThemeConfigValue>,
  variant: BrandAssetVariant,
  surfaceTone: BrandSurfaceTone
): string {
  const preferred = variant === 'symbol'
    ? (surfaceTone === 'dark' ? theme.brandAssets.symbol.dark : theme.brandAssets.symbol.light)
    : (surfaceTone === 'dark' ? theme.brandAssets.fullLogo.dark : theme.brandAssets.fullLogo.light)

  const fallback = variant === 'symbol'
    ? (surfaceTone === 'dark' ? theme.brandAssets.fullLogo.dark : theme.brandAssets.fullLogo.light)
    : ''

  return preferred || fallback || theme.logoUrl || ''
}

export function resolveFaviconUrl(theme: Required<UIThemeConfigValue>): string {
  return theme.brandAssets.favicon
    || theme.faviconUrl
    || theme.brandAssets.symbol.dark
    || theme.brandAssets.symbol.light
    || theme.brandAssets.fullLogo.dark
    || theme.brandAssets.fullLogo.light
    || theme.logoUrl
    || DEFAULT_THEME.brandAssets.favicon
}

function pickText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value.trim()
  return normalized || fallback
}

function pickOptionalText(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim()
}

function pickColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value.trim()
  return normalized || fallback
}

function pickRadius(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(Math.max(value, 0), 32)
}

function pickBrandAssets(value: unknown): BrandAssets {
  const defaultAssets = DEFAULT_THEME.brandAssets

  if (!value || typeof value !== 'object') {
    return defaultAssets
  }

  const assets = value as Record<string, unknown>

  return {
    fullLogo: {
      light: pickOptionalText((assets.fullLogo as Record<string, unknown>)?.light),
      dark: pickOptionalText((assets.fullLogo as Record<string, unknown>)?.dark),
    },
    symbol: {
      light: pickOptionalText((assets.symbol as Record<string, unknown>)?.light),
      dark: pickOptionalText((assets.symbol as Record<string, unknown>)?.dark),
    },
    favicon: pickOptionalText(assets.favicon),
  }
}

function pickAppearance(value: unknown): AppearanceMode {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value
  }
  return DEFAULT_THEME.appearance
}

export function themeToCssVariables(theme: Required<UIThemeConfigValue>): Record<string, string> {
  return {
    '--background': toRgbTriplet(theme.background, DEFAULT_THEME.background),
    '--foreground': toRgbTriplet(theme.foreground, DEFAULT_THEME.foreground),
    '--card': toRgbTriplet(theme.card, DEFAULT_THEME.card),
    '--card-foreground': toRgbTriplet(theme.cardForeground, DEFAULT_THEME.cardForeground),
    '--popover': toRgbTriplet(theme.popover, DEFAULT_THEME.popover),
    '--popover-foreground': toRgbTriplet(theme.popoverForeground, DEFAULT_THEME.popoverForeground),
    '--primary': toRgbTriplet(theme.primary, DEFAULT_THEME.primary),
    '--primary-foreground': toRgbTriplet(theme.primaryForeground, DEFAULT_THEME.primaryForeground),
    '--secondary': toRgbTriplet(theme.secondary, DEFAULT_THEME.secondary),
    '--secondary-foreground': toRgbTriplet(theme.secondaryForeground, DEFAULT_THEME.secondaryForeground),
    '--muted': toRgbTriplet(theme.muted, DEFAULT_THEME.muted),
    '--muted-foreground': toRgbTriplet(theme.mutedForeground, DEFAULT_THEME.mutedForeground),
    '--border': toRgbTriplet(theme.border, DEFAULT_THEME.border),
    '--input': toRgbTriplet(theme.input, DEFAULT_THEME.input),
    '--ring': toRgbTriplet(theme.ring, DEFAULT_THEME.ring),
    '--destructive': toRgbTriplet(theme.destructive, DEFAULT_THEME.destructive),
    '--destructive-foreground': toRgbTriplet(theme.destructiveForeground, DEFAULT_THEME.destructiveForeground),
    '--radius-md': `${theme.radiusMd}px`,
    '--radius-lg': `${theme.radiusLg}px`,
  }
}

function toRgbTriplet(value: string, fallback: string): string {
  const normalized = value.trim()

  if (/^\d+\s+\d+\s+\d+$/.test(normalized)) {
    return normalized
  }

  const rgbMatch = normalized.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i)
  if (rgbMatch) {
    return `${rgbMatch[1]} ${rgbMatch[2]} ${rgbMatch[3]}`
  }

  const hex = normalized.replace('#', '')
  const candidate = hex.length === 3
    ? hex.split('').map((char) => `${char}${char}`).join('')
    : hex

  if (/^[0-9a-f]{6}$/i.test(candidate)) {
    const red = parseInt(candidate.slice(0, 2), 16)
    const green = parseInt(candidate.slice(2, 4), 16)
    const blue = parseInt(candidate.slice(4, 6), 16)
    return `${red} ${green} ${blue}`
  }

  if (normalized !== fallback) {
    return toRgbTriplet(fallback, fallback)
  }

  return '255 255 255'
}
