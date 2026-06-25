// 登录防爆破 (Rate Limiting for Login)
// 防止暴力破解密码，限制单 IP / 单账号的尝试频率
//
// 策略：
// - 同一 IP 失败 15 次后，锁定 15 分钟
// - 同一账号失败 5 次后，锁定 15 分钟
// - 锁定期间返回 429 状态码
// - 成功登录后清零计数器
//
// 数据存储：login_attempts 表（SQL 迁移见 migrations/）

import { supabaseAdmin } from './supabase'

export const LOGIN_MAX_FAILURES = 5
export const LOGIN_LOCK_DURATION_MINUTES = 15

const MAX_FAILURES = LOGIN_MAX_FAILURES
const LOCK_DURATION_MINUTES = LOGIN_LOCK_DURATION_MINUTES

interface RateLimitResult {
  allowed: boolean
  remainingAttempts: number
  retryAfterSeconds?: number
  reason?: string
}

/**
 * 检查登录尝试是否被允许
 * @param identifier 账号标识（email 或 phone）
 * @param ipAddress 客户端 IP
 */
export async function checkLoginRateLimit(
  identifier: string,
  ipAddress: string
): Promise<RateLimitResult> {
  const since = new Date(Date.now() - LOCK_DURATION_MINUTES * 60 * 1000).toISOString()

  const [accountResult, ipResult] = await Promise.all([
    supabaseAdmin
      .from('login_attempts')
      .select('id, attempted_at')
      .eq('identifier', identifier)
      .eq('success', false)
      .gte('attempted_at', since)
      .order('attempted_at', { ascending: false })
      .limit(MAX_FAILURES),
    supabaseAdmin
      .from('login_attempts')
      .select('id, attempted_at')
      .eq('ip_address', ipAddress)
      .eq('success', false)
      .gte('attempted_at', since)
      .order('attempted_at', { ascending: false })
      .limit(MAX_FAILURES * 3),
  ])

  const accountFailures = accountResult.data || []
  const ipFailures = ipResult.data || []
  const accountCount = accountFailures.length
  const ipCount = ipFailures?.length || 0

  // 决策
  if (accountCount >= MAX_FAILURES) {
    const oldestFailure = accountFailures?.[accountCount - 1]
    const retryAfter = oldestFailure
      ? Math.ceil(
          (new Date(oldestFailure.attempted_at).getTime() +
            LOCK_DURATION_MINUTES * 60 * 1000 -
            Date.now()) /
            1000
        )
      : LOCK_DURATION_MINUTES * 60

    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds: Math.max(retryAfter, 0),
      reason: 'account_locked',
    }
  }

  if (ipCount >= MAX_FAILURES * 3) {
    // IP 维度放宽 3 倍，避免误伤共享 IP
    const oldestFailure = ipFailures?.[ipCount - 1]
    const retryAfter = oldestFailure
      ? Math.ceil(
          (new Date(oldestFailure.attempted_at).getTime() +
            LOCK_DURATION_MINUTES * 60 * 1000 -
            Date.now()) /
            1000
        )
      : LOCK_DURATION_MINUTES * 60

    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds: Math.max(retryAfter, 0),
      reason: 'ip_locked',
    }
  }

  return {
    allowed: true,
    remainingAttempts: Math.max(0, MAX_FAILURES - Math.max(accountCount, ipCount)),
  }
}

/**
 * 记录一次登录尝试
 */
export async function recordLoginAttempt(
  identifier: string,
  ipAddress: string,
  success: boolean
): Promise<void> {
  await supabaseAdmin.from('login_attempts').insert({
    identifier,
    ip_address: ipAddress,
    success,
    attempted_at: new Date().toISOString(),
  })
}

/**
 * 从请求中提取客户端 IP
 * 支持 Cloudflare / Vercel / 标准代理头
 */
export function getClientIp(req: { headers: Headers }): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}
