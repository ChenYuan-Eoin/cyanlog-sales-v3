'use client'

import { useEffect } from 'react'

import { sanitizeThemeValue, themeToCssVariables } from '@/lib/ui-theme-shared'

export function RuntimeThemeLoader() {
  useEffect(() => {
    let cancelled = false

    async function loadTheme() {
      const token = window.localStorage.getItem('token')
      if (!token) {
        return
      }

      try {
        const response = await fetch('/api/configs?type=UI_THEME&status=PUBLISHED', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        if (!response.ok) {
          return
        }

        const configs = await response.json() as Array<{ value?: Record<string, unknown> }>
        const theme = sanitizeThemeValue(configs[0]?.value)
        const variables = themeToCssVariables(theme)

        if (cancelled) {
          return
        }

        Object.entries(variables).forEach(([key, value]) => {
          document.documentElement.style.setProperty(key, value)
        })

        document.documentElement.dataset.brandName = theme.brandName
        document.documentElement.dataset.brandShortName = theme.brandShortName
        document.documentElement.dataset.logoUrl = theme.logoUrl

        if (theme.productTitle) {
          document.title = theme.productTitle
        }

        if (theme.faviconUrl) {
          const rels = ['icon', 'shortcut icon', 'apple-touch-icon']
          rels.forEach((rel) => {
            let link = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null
            if (!link) {
              link = document.createElement('link')
              link.rel = rel
              document.head.appendChild(link)
            }
            link.href = theme.faviconUrl
          })
        }
      } catch {
        // Ignore runtime theme failures and keep defaults.
      }
    }

    void loadTheme()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
