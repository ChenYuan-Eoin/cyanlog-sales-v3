export type ReviewTaskStatus = 'PENDING' | 'PARSING' | 'ANALYZING' | 'COMPLETED' | 'FAILED' | string

export type ComparisonTaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | string

export interface VersionLike {
  version_number?: number | null
  source?: string | null
}

export function contractVersionLabel(input: {
  latest_version?: VersionLike | null
  contract_versions?: VersionLike[] | null
}): string {
  const latest = input.latest_version ?? input.contract_versions?.[0]
  return latest?.version_number && latest.version_number > 0
    ? `v${latest.version_number}`
    : '版本待确认'
}

export function draftVersionLabel(versionNumber?: number | null): string {
  return versionNumber && versionNumber > 0
    ? `v${versionNumber} · 草稿`
    : '版本待确认'
}

export function versionSourceLabel(source?: string | null): string {
  switch (source) {
    case 'original':
      return '源文件'
    case 'review_revision':
      return '批注/修订版'
    case 'manual_revision':
      return '客户/人工版'
    default:
      return '版本来源待确认'
  }
}

export function reviewTaskState(status: ReviewTaskStatus) {
  switch (status) {
    case 'COMPLETED':
      return {
        label: '审核完成',
        color: 'bg-green-100 text-green-700',
        nextAction: '查看批注 / 再审核',
      }
    case 'PENDING':
      return {
        label: '待审核',
        color: 'bg-amber-100 text-amber-700',
        nextAction: '发起审核',
      }
    case 'PARSING':
      return {
        label: '解析中',
        color: 'bg-blue-100 text-blue-700',
        nextAction: '查看解析进度',
      }
    case 'ANALYZING':
      return {
        label: '审核中',
        color: 'bg-indigo-100 text-indigo-700',
        nextAction: '查看审核进度',
      }
    case 'FAILED':
      return {
        label: '审核失败',
        color: 'bg-red-100 text-red-700',
        nextAction: '检查失败原因 / 再审核',
      }
    default:
      return {
        label: status || '状态待确认',
        color: 'bg-slate-100 text-slate-600',
        nextAction: '进入审核任务',
      }
  }
}

export function comparisonTaskState(status?: ComparisonTaskStatus | null) {
  switch (status) {
    case 'completed':
      return {
        label: '比对完成',
        color: 'bg-emerald-100 text-emerald-700',
        nextAction: '查看差异 / 导出报告',
      }
    case 'processing':
      return {
        label: '比对中',
        color: 'bg-indigo-100 text-indigo-700',
        nextAction: '查看比对进度',
      }
    case 'failed':
      return {
        label: '比对失败',
        color: 'bg-red-100 text-red-700',
        nextAction: '替换文件 / 重新对比',
      }
    default:
      return {
        label: '待比对',
        color: 'bg-amber-100 text-amber-700',
        nextAction: '上传旧版与新版',
      }
  }
}
