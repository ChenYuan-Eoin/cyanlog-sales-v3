// 错误日志工具 - 自托管替代 Sentry
// 错误写入 Supabase error_logs 表，管理员可在后台查询

import { supabaseAdmin } from './supabase'
import type { NextRequest } from 'next/server'

export type ErrorLevel = 'error' | 'warn' | 'info'

export interface LogErrorParams {
  level?: ErrorLevel
  source?: 'api' | 'client' | 'worker'
  path?: string
  method?: string
  statusCode?: number
  message: string
  error?: Error | unknown
  context?: Record<string, unknown>
  userId?: string
  ipAddress?: string
  userAgent?: string
  req?: NextRequest
}

/**
 * 记录错误到数据库
 * 设计原则：永不抛出异常（避免错误日志本身导致二次故障）
 */
export async function logError(params: LogErrorParams): Promise<void> {
  try {
    const error = params.error
    const stack = error instanceof Error ? error.stack?.substring(0, 4096) : undefined

    // 从 req 中提取信息
    let path = params.path
    let method = params.method
    let ip = params.ipAddress
    let ua = params.userAgent
    if (params.req) {
      path = path || params.req.nextUrl?.pathname || params.req.url
      method = method || params.req.method
      ip = ip || params.req.headers.get('cf-connecting-ip') || params.req.headers.get('x-forwarded-for') || 'unknown'
      ua = ua || params.req.headers.get('user-agent') || undefined
    }

    const { error: insertErr } = await supabaseAdmin.from('error_logs').insert({
      level: params.level || 'error',
      source: params.source || 'api',
      path,
      method,
      status_code: params.statusCode,
      message: params.message.substring(0, 1000),
      stack,
      context: params.context,
      user_id: params.userId,
      ip_address: ip,
      user_agent: ua?.substring(0, 500),
    })

    if (insertErr) {
      // 数据库写入失败：降级到 console.error
      console.error('[error-log] DB write failed:', insertErr.message, '| original:', params.message)
    }
  } catch (err) {
    // 任何异常都不能抛出
    console.error('[error-log] Unexpected:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * 便捷包装：API 路由错误处理
 */
export async function withErrorLogging<T>(
  req: NextRequest | undefined,
  fn: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    await logError({
      req,
      error,
      message: error instanceof Error ? error.message : String(error),
      context,
    })
    throw error
  }
}
