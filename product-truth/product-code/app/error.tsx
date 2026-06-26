'use client'

import { useCallback, useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { scheduleBoundaryReport, warmHomeRecovery as primeHomeRecovery } from './error-recovery'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  const [isNavigatingHome, startHomeNavigation] = useTransition()
  const homeWarmupStarted = useRef(false)

  const handleHomeWarmup = useCallback(() => {
    if (homeWarmupStarted.current) return

    homeWarmupStarted.current = true
    primeHomeRecovery(router)
  }, [router])

  useEffect(() => {
    handleHomeWarmup()
  }, [handleHomeWarmup])

  useEffect(() => scheduleBoundaryReport(error), [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold">页面发生错误</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          错误已记录。请重试当前操作；如果问题持续存在，再查看 `error_logs` 或 Sentry 事件。
        </p>
        <div className="mt-4 flex gap-3">
          <Button onClick={reset}>重试</Button>
          <Button
            variant="outline"
            disabled={isNavigatingHome}
            onFocus={handleHomeWarmup}
            onPointerEnter={handleHomeWarmup}
            onClick={() => {
              handleHomeWarmup()
              startHomeNavigation(() => {
                router.replace('/')
              })
            }}
          >
            {isNavigatingHome ? '返回中...' : '返回首页'}
          </Button>
        </div>
      </div>
    </div>
  )
}
