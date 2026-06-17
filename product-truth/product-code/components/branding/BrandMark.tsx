'use client'

import { useEffect, useState } from 'react'
import { useBranding } from '@/components/branding/BrandingProvider'
import { LOGO_CONTAINER, resolveBrandImageUrl, type BrandSurfaceTone } from '@/lib/ui-theme-shared'

interface BrandMarkProps {
  size?: number
  className?: string
  variant?: 'full' | 'symbol'  // full: 完整Logo, symbol: 仅图标
  surface?: 'auto' | BrandSurfaceTone
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

export function BrandMark({ size = 40, className, variant = 'full', surface = 'auto' }: BrandMarkProps) {
  const theme = useBranding()
  const followsDarkUi = useIsDarkMode(theme.appearance)
  const surfaceTone: BrandSurfaceTone = surface === 'auto'
    ? (followsDarkUi ? 'dark' : 'light')
    : surface
  const finalUrl = resolveBrandImageUrl(theme, variant, surfaceTone)

  // 品牌缩写兜底
  const brandInitials = theme.brandShortName || theme.brandName.slice(0, 2).toUpperCase()

  if (finalUrl) {
    if (variant === 'symbol') {
      return (
        <div
          className={className}
          style={{
            width: size,
            height: size,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={finalUrl}
            alt={theme.brandName}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
            }}
          />
        </div>
      )
    }

    return (
      <div
        className={className}
        style={{
          height: Math.max(size, LOGO_CONTAINER.height),
          padding: `0 ${LOGO_CONTAINER.padding}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          overflow: 'hidden',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={finalUrl}
          alt={theme.brandName}
          style={{
            maxHeight: Math.min(size, LOGO_CONTAINER.maxLogoHeight + 8),
            maxWidth: '100%',
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
