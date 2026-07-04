import { describe, expect, it } from 'vitest'
import { deriveReviewWorkflowState } from './review-state-machine'

describe('deriveReviewWorkflowState', () => {
  it('keeps uploaded contracts on the start-review path', () => {
    const state = deriveReviewWorkflowState({
      status: 'PENDING',
      hasSourceAsset: true,
    })

    expect(state.phase).toBe('uploaded_ready')
    expect(state.nextActionLabel).toBe('发起审核')
    expect(state.canStartReview).toBe(true)
    expect(state.canExportComments).toBe(false)
  })

  it('does not call running review runs a new review', () => {
    const state = deriveReviewWorkflowState({
      status: 'ANALYZING',
      hasSourceAsset: true,
      reviewRunId: 'run-1',
    })

    expect(state.phase).toBe('review_running')
    expect(state.nextActionLabel).toBe('查看进度')
    expect(state.primaryAction).toBe('continue_review')
    expect(state.canStartReview).toBe(false)
  })

  it('distinguishes completed reviews that can export native comments', () => {
    const state = deriveReviewWorkflowState({
      status: 'COMPLETED',
      hasSourceAsset: true,
      hasReviewArtifacts: true,
      exportReady: true,
    })

    expect(state.phase).toBe('review_completed_ready')
    expect(state.nextActionLabel).toBe('导出批注版')
    expect(state.canExportComments).toBe(true)
  })

  it('does not pretend blocked completed reviews already have an exportable comment file', () => {
    const state = deriveReviewWorkflowState({
      status: 'COMPLETED',
      hasSourceAsset: true,
      hasReviewArtifacts: true,
      exportReady: false,
      exportBlockedReasons: ['3 条 Word 批注意图需要人工定位'],
    })

    expect(state.phase).toBe('review_completed_blocked')
    expect(state.nextActionLabel).toBe('处理批注门禁')
    expect(state.primaryButtonLabel).toBe('查看导出原因')
    expect(state.canExportComments).toBe(false)
    expect(state.nextActionDescription).toContain('人工定位')
  })

  it('routes failed reviews to evidence review and retry', () => {
    const state = deriveReviewWorkflowState({
      status: 'FAILED',
      hasSourceAsset: true,
    })

    expect(state.phase).toBe('review_failed')
    expect(state.detailPanel).toBe('evidence')
    expect(state.primaryButtonLabel).toBe('再次审核')
    expect(state.canStartReview).toBe(true)
  })
})
