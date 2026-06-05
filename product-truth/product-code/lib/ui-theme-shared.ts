export interface UIThemeConfigValue {
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

export const DEFAULT_THEME: Required<UIThemeConfigValue> = {
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
