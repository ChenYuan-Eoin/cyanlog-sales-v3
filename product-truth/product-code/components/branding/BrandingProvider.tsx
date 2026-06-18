'use client'

import { createContext, useContext, useEffect, useState } from 'react'

import type { UIThemeConfigValue } from '@/lib/ui-theme-shared'

const BrandingContext = createContext<Required<UIThemeConfigValue> | null>(null)

// 运行时主题的全局同步通道（供 SSR/CSR 桥接）
declare global {
  interface Window {
    __RUNTIME_THEME__?: Required<UIThemeConfigValue>
  }
}

export function BrandingProvider({
  value,
  children,
}: {
  value: Required<UIThemeConfigValue>
  children: React.ReactNode
}) {
  const [theme, setTheme] = useState<Required<UIThemeConfigValue>>(value)

  useEffect(() => {
    // 客户端挂载时：检查 RuntimeThemeLoader 是否已将运行时主题写入全局
    if (window.__RUNTIME_THEME__) {
      setTheme(window.__RUNTIME_THEME__)
    }

    // 监听运行时主题变更事件
    const handler = (e: CustomEvent<Required<UIThemeConfigValue>>) => {
      setTheme(e.detail)
    }
    window.addEventListener('runtime-theme-applied', handler as EventListener)
    return () => {
      window.removeEventListener('runtime-theme-applied', handler as EventListener)
    }
  }, [])

  return (
    <BrandingContext.Provider value={theme}>
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
