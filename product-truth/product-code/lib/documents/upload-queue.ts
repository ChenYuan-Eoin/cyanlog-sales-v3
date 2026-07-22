export interface UploadQueueCursor {
  current: number
}

export type UploadQueueAdvance =
  | { done: true; completedIndex: number }
  | { done: false; completedIndex: number; nextIndex: number }

export interface UploadQueueRemoval {
  nextIndex: number
  removedStartedTerminal: boolean
}

interface CreateContractPayload {
  contract_id?: unknown
  id?: unknown
  data?: {
    contract_id?: unknown
    id?: unknown
  }
}

export function createdContractId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const candidate = payload as CreateContractPayload
  const value = candidate.data?.contract_id
    ?? candidate.data?.id
    ?? candidate.contract_id
    ?? candidate.id
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * 推进多文件上传的唯一同步游标。
 *
 * React state 只用于显示；异步 onComplete 即使来自旧 render，也必须共享同一个
 * mutable cursor，避免第二个文件完成后继续按索引 0 重复创建和上传。
 */
export function completeCurrentUpload(
  cursor: UploadQueueCursor,
  totalFiles: number,
): UploadQueueAdvance {
  if (!Number.isInteger(totalFiles) || totalFiles <= 0) {
    throw new Error('Upload queue requires at least one file')
  }
  if (!Number.isInteger(cursor.current) || cursor.current < 0 || cursor.current >= totalFiles) {
    throw new Error('Upload queue cursor is out of range')
  }

  const completedIndex = cursor.current
  if (completedIndex === totalFiles - 1) {
    // totalFiles 是唯一终态；停在最后一个有效索引会让慢导航期间再次上传最后一项。
    cursor.current = totalFiles
    return { done: true, completedIndex }
  }

  const nextIndex = completedIndex + 1
  cursor.current = nextIndex
  return { done: false, completedIndex, nextIndex }
}

/**
 * 计算删除队列项后的同步游标。若删除的是已经启动且位于队尾的当前项，
 * 新数组长度就是 terminal 游标，调用方必须离开上传页，不能再显示一个不可执行的完成按钮。
 */
export function planUploadQueueRemoval(
  currentIndex: number,
  totalFiles: number,
  removedIndex: number,
  currentItemStarted: boolean,
): UploadQueueRemoval {
  if (
    !Number.isInteger(totalFiles)
    || totalFiles < 1
    || !Number.isInteger(currentIndex)
    || currentIndex < 0
    || currentIndex >= totalFiles
    || !Number.isInteger(removedIndex)
    || removedIndex < 0
    || removedIndex >= totalFiles
  ) {
    throw new Error('Upload queue removal is out of range')
  }

  const removedStartedTerminal = currentItemStarted
    && removedIndex === currentIndex
    && removedIndex === totalFiles - 1

  if (removedStartedTerminal) {
    return { nextIndex: totalFiles - 1, removedStartedTerminal: true }
  }
  if (removedIndex < currentIndex) {
    return { nextIndex: currentIndex - 1, removedStartedTerminal: false }
  }
  return { nextIndex: currentIndex, removedStartedTerminal: false }
}
