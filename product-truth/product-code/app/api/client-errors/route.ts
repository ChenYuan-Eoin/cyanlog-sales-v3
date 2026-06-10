import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'

import { logError } from '@/lib/error-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const clientErrorSchema = z.object({
  kind: z.enum(['error', 'unhandledrejection', 'chunk-load']),
  message: z.string().min(1).max(1000),
  stack: z.string().max(6000).optional(),
  path: z.string().optional(),
  href: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = clientErrorSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const payload = parsed.data
    const error = new Error(payload.message)
    if (payload.stack) {
      error.stack = payload.stack
    }

    Sentry.captureException(error, {
      tags: {
        source: 'client',
        kind: payload.kind,
      },
      extra: payload.context,
    })

    await logError({
      req,
      level: payload.kind === 'chunk-load' ? 'warn' : 'error',
      source: 'client',
      path: payload.path,
      message: payload.message,
      error,
      context: {
        kind: payload.kind,
        href: payload.href,
        ...payload.context,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[client-errors] failed', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
