'use client'

import { useEffect, useState } from 'react'
import { useBranding } from '@/components/branding/BrandingProvider'
import { LOGO_CONTAINER } from '@/lib/ui-theme-shared'

interface BrandMarkProps {
  size?: number
  className?: string
  variant?: 'full' | 'symbol'  // full: 完整Logo, symbol: 仅图标
}

// 检测系统/配置是否为暗色模式
function useIsDarkMode(appearance: 'system' | 'light' | 'dark'): boolean {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    if (appearance === 'dark') {
      setIsDark(true)
      return
    }
    if (appearance === 'light') {
      setIsDark(false)
      return
    }

    // system: 监听系统偏好
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    setIsDark(mediaQuery.matches)

    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [appearance])

  return isDark
}

export function BrandMark({ size = 40, className, variant = 'full' }: BrandMarkProps) {
  const theme = useBranding()
  const isDark = useIsDarkMode(theme.appearance)

  // 选择对应版本的 Logo
  const assets = theme.brandAssets
  const logoUrl = variant === 'symbol'
    ? (isDark ? assets.symbol.dark : assets.symbol.light)
    : (isDark ? assets.fullLogo.dark : assets.fullLogo.light)

  // 回退：旧版 logoUrl 或品牌缩写
  const fallbackUrl = isDark ? '' : theme.logoUrl
  const finalUrl = logoUrl || fallbackUrl

  // 品牌缩写兜底
  const brandInitials = theme.brandShortName || theme.brandName.slice(0, 2).toUpperCase()

  if (finalUrl) {
    return (
      <div
        className={className}
        style={{
          height: LOGO_CONTAINER.height,
          padding: `0 ${LOGO_CONTAINER.padding}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          overflow: 'hidden',
        }}
      >
        <img
          src={finalUrl}
          alt={theme.brandName}
          style={{
            maxHeight: LOGO_CONTAINER.maxLogoHeight,
            width: 'auto',
            objectFit: 'contain',
          }}
        />
      </div>
    )
  }

  // 无 Logo 时显示品牌缩写
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgb(var(--primary))',
        color: 'rgb(var(--primary-foreground))',
        fontWeight: 700,
      }}
    >
      {brandInitials}
    </div>
  )
}
