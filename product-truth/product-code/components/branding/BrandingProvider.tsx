'use client'

import { createContext, useContext } from 'react'

import type { UIThemeConfigValue } from '@/lib/ui-theme-shared'

const BrandingContext = createContext<Required<UIThemeConfigValue> | null>(null)

export function BrandingProvider({
  value,
  children,
}: {
  value: Required<UIThemeConfigValue>
  children: React.ReactNode
}) {
  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  )
}

export function useBranding() {
  const value = useContext(BrandingContext)
  if (!value) {
    throw new Error('useBranding must be used inside BrandingProvider')
  }
  return value
}
