import type { FeishuSyncFeedback } from './types'

export type FeishuSyncResponse = {
  code?: string
  connector?: string
  scope?: string
  success?: boolean
  sync_status?: 'completed' | 'partial'
  imported?: number
  updated?: number
  total?: number
  departments?: {
    imported?: number
    updated?: number
    failed?: number
    total?: number
  }
  members?: {
    imported?: number
    updated?: number
    skipped?: number
    failed?: number
    total?: number
  }
  warnings?: Array<{
    scope?: string
    sourceId?: string
    message?: string
  }>
  message?: string
  error?: string
  hint?: string
  missing?: string[]
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function buildFeishuSuccessFeedback(data: FeishuSyncResponse): FeishuSyncFeedback {
  const departmentImported = asNumber(data.departments?.imported ?? data.imported)
  const departmentUpdated = asNumber(data.departments?.updated ?? data.updated)
  const departmentFailed = asNumber(data.departments?.failed)
  const departmentTotal = asNumber(data.departments?.total ?? data.total)
  const memberImported = asNumber(data.members?.imported)
  const memberUpdated = asNumber(data.members?.updated)
  const memberSkipped = asNumber(data.members?.skipped)
  const memberFailed = asNumber(data.members?.failed)
  const memberTotal = asNumber(data.members?.total)
  const isPartial = data.sync_status === 'partial' || (data.warnings?.length ?? 0) > 0

  return {
    status: isPartial ? 'warning' : 'success',
    title: typeof data.message === 'string' ? data.message : '飞书组织架构同步完成',
    message: `部门新增 ${departmentImported} 个、更新 ${departmentUpdated} 个、失败 ${departmentFailed} 个、总计 ${departmentTotal} 个；成员新增 ${memberImported} 个、更新 ${memberUpdated} 个、跳过 ${memberSkipped} 个、失败 ${memberFailed} 个、总计 ${memberTotal} 个。`,
    detail: isPartial
      ? `部分飞书数据未同步：${data.warnings?.map((warning) => warning.message).filter(Boolean).slice(0, 3).join('；') || '请检查飞书通讯录权限范围。'}`
      : '部门、成员和主部门关系已刷新。',
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
