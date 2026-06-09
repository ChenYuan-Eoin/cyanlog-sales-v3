'use client'

import { useBranding } from '@/components/branding/BrandingProvider'

interface BrandMarkProps {
  size?: number
  className?: string
}

export function BrandMark({ size = 40, className }: BrandMarkProps) {
  const theme = useBranding()

  if (theme.logoUrl) {
    return (
      <img
        src={theme.logoUrl}
        alt={theme.brandName}
        width={size}
        height={size}
        className={className}
        style={{ width: size, height: size, objectFit: 'cover', borderRadius: 10 }}
      />
    )
  }

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
      {theme.brandShortName || theme.brandName.slice(0, 2).toUpperCase()}
    </div>
  )
}
