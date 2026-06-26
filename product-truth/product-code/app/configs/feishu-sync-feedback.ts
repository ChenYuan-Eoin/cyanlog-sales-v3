import type { FeishuSyncFeedback } from './types'

export type FeishuSyncResponse = {
  code?: string
  connector?: string
  scope?: string
  success?: boolean
  imported?: number
  updated?: number
  total?: number
  message?: string
  error?: string
  hint?: string
  missing?: string[]
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function buildFeishuSuccessFeedback(data: FeishuSyncResponse): FeishuSyncFeedback {
  const imported = asNumber(data.imported)
  const updated = asNumber(data.updated)
  const total = asNumber(data.total)

  return {
    status: 'success',
    title: typeof data.message === 'string' ? data.message : '飞书部门同步完成',
    message: `新增 ${imported} 个，更新 ${updated} 个，总计 ${total} 个部门；组织架构已刷新。`,
    detail: '当前 MVP 仅同步部门结构，不会导入成员档案。',
  }
}

export function buildFeishuErrorFeedback(status: number, data: FeishuSyncResponse): FeishuSyncFeedback {
  const isNotConfigured = data.code === 'FEISHU_NOT_CONFIGURED' || status === 503

  return {
    status: isNotConfigured ? 'warning' : 'error',
    title: isNotConfigured ? '飞书同步未配置' : '飞书同步失败',
    message: data.error ?? '未知错误',
    detail: data.hint ?? (isNotConfigured
      ? '请配置飞书应用凭据后重新部署。'
      : '请稍后重试，或查看 Vercel 函数日志定位上游错误。'),
  }
}

export function buildFeishuNetworkErrorFeedback(): FeishuSyncFeedback {
  return {
    status: 'error',
    title: '飞书同步请求失败',
    message: '网络错误或接口无响应。',
    detail: '请确认登录状态有效，并检查当前环境是否可访问服务端接口。',
  }
}
