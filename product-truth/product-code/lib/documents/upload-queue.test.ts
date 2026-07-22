import { describe, expect, it } from 'vitest'
import {
  completeCurrentUpload,
  createdContractId,
  planUploadQueueRemoval,
} from './upload-queue'

describe('completeCurrentUpload', () => {
  it('同一个旧回调连续完成两个文件时只推进一次，并在第二次结束', () => {
    const cursor = { current: 0 }
    const staleOnComplete = () => completeCurrentUpload(cursor, 2)

    expect(staleOnComplete()).toEqual({
      done: false,
      completedIndex: 0,
      nextIndex: 1,
    })
    expect(cursor.current).toBe(1)
    expect(staleOnComplete()).toEqual({ done: true, completedIndex: 1 })
    expect(cursor.current).toBe(2)
  })

  it('拒绝越界游标，避免静默重复或跳过文件', () => {
    expect(() => completeCurrentUpload({ current: 2 }, 2)).toThrow(
      'Upload queue cursor is out of range',
    )
  })

  it('读取标准和历史合同创建响应，但不猜测缺失 ID', () => {
    expect(createdContractId({ success: true, data: { contract_id: 'contract-1' } }))
      .toBe('contract-1')
    expect(createdContractId({ contract_id: 'legacy-contract' })).toBe('legacy-contract')
    expect(createdContractId({ success: true, data: {} })).toBeNull()
  })

  it('删除已启动的失败末项后进入新数组终态，删除未启动项则仍可继续选择', () => {
    expect(planUploadQueueRemoval(1, 2, 1, true)).toEqual({
      nextIndex: 1,
      removedStartedTerminal: true,
    })
    expect(planUploadQueueRemoval(0, 1, 0, false)).toEqual({
      nextIndex: 0,
      removedStartedTerminal: false,
    })
    expect(planUploadQueueRemoval(1, 3, 1, true)).toEqual({
      nextIndex: 1,
      removedStartedTerminal: false,
    })
  })
})
