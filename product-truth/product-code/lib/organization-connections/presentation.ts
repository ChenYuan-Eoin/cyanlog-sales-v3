import type { ConnectionSummary } from './types'

/** Display persisted configuration facts, never a live provider heartbeat. */
export function connectionPresentation(connection: Pick<ConnectionSummary,
  'configured' | 'state' | 'revision' | 'effectiveRevision' | 'effectiveVerified' | 'draftCheckStatus'
> | null) {
  const configured = Boolean(connection?.configured)
  const currentConfigurationEnabled = Boolean(connection?.effectiveVerified
    && connection.effectiveRevision === connection.revision)
  const checkLabel = !configured ? '未配置'
    : connection?.draftCheckStatus === 'preview_ready' ? '配置检查通过'
      : connection?.draftCheckStatus === 'failed' ? '配置检查失败' : '配置待检查'
  const directoryLabel = currentConfigurationEnabled ? '目录连接已启用'
    : connection?.effectiveVerified ? '沿用上一份配置'
      : connection?.effectiveRevision && connection.state === 'disabled' ? '目录连接已停用'
        : '目录连接未启用'
  const directoryDetail = currentConfigurationEnabled
    ? '后续同步使用当前配置；每次读取差异后仍需确认，才会更新部门、员工和归属。'
    : connection?.effectiveVerified
      ? '新草稿尚未生效。检查通过并应用新配置后，再重新读取同步差异；已有组织数据保留。'
      : '当前不能应用新的组织同步。先检查配置，再启用目录连接；已同步的部门、员工和归属仍保留。'
  return {
    checkLabel, directoryLabel, directoryDetail, currentConfigurationEnabled,
    activationLabel: connection?.effectiveVerified ? '应用已验证的新配置' : '启用目录连接',
  }
}
