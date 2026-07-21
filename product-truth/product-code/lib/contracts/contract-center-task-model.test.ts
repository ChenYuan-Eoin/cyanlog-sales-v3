import { describe, expect, it } from 'vitest'
import { deriveContractCenterTaskModel } from './contract-center-task-model'

const sourceV1 = {
  id: 'source-v1',
  versionNumber: 1,
  source: 'original',
  storagePath: 'contracts/acme/v1.docx',
  createdAt: '2026-07-20T08:00:00.000Z',
}

const sourceV2 = {
  id: 'source-v2',
  versionNumber: 2,
  source: 'manual_revision',
  storagePath: 'contracts/acme/v2.docx',
  createdAt: '2026-07-21T08:00:00.000Z',
}

describe('deriveContractCenterTaskModel', () => {
  it('always exposes the four stable business tasks without inventing a selected contract', () => {
    const model = deriveContractCenterTaskModel({})

    expect(model.taskOrder).toEqual([
      'draft_contract',
      'start_review',
      'continue_review',
      'compare_versions',
    ])
    expect(model.tasks.draft_contract).toMatchObject({
      availability: 'available',
      label: '起草合同',
      href: '/contracts/draft',
      blockedReason: null,
    })
    expect(model.tasks.start_review).toMatchObject({
      availability: 'available',
      label: '上传并发起风险审核',
      objectLabel: '一份 Word（DOC、DOCX、DOCM）或 PDF 原文件',
      preconditionLabel: expect.stringContaining('DOC 需转换'),
      href: '/contracts/new?from=workbench',
    })
    expect(model.tasks.continue_review).toMatchObject({
      availability: 'blocked',
      href: null,
    })
    expect(model.tasks.compare_versions).toMatchObject({
      availability: 'blocked',
      href: null,
    })
    expect(model.tasks.compare_versions.blockedReason).toContain('不会替你猜测')
  })

  it('separates source versions from review outputs before choosing the current source', () => {
    const model = deriveContractCenterTaskModel({
      contract: { id: 'contract-1', name: 'ACME 服务合同' },
      versions: [
        sourceV1,
        {
          id: 'annotated-v2',
          versionNumber: 2,
          source: 'review_revision',
          kind: 'source' as const,
          storagePath: 'contracts/acme/annotated.docx',
        },
        sourceV2,
        {
          id: 'declared-output',
          versionNumber: 4,
          source: 'manual_revision',
          kind: 'output',
          storagePath: 'contracts/acme/output.pdf',
        },
      ],
    })

    expect(model.sourceVersions.map((version) => version.id)).toEqual(['source-v2', 'source-v1'])
    expect(model.outputVersions.map((version) => version.id)).toEqual(['declared-output', 'annotated-v2'])
    expect(model.currentSourceVersion?.id).toBe('source-v2')
    expect(model.currentSourceVersionLabel).toBe('v2')
    expect(model.comparison).toMatchObject({
      state: 'ready',
      sourceVersionCount: 2,
      canStartComparison: true,
    })
  })

  it('requires current-file identity evidence before allowing a review to start', () => {
    const ready = deriveContractCenterTaskModel({
      contract: { id: 'contract-1' },
      versions: [sourceV1],
      currentSourceStoragePath: sourceV1.storagePath,
      sourceIdentity: {
        state: 'ready',
        storagePath: sourceV1.storagePath,
      },
    })

    expect(ready.sourceIdentity).toMatchObject({
      state: 'ready',
      ready: true,
      canStartReview: true,
      label: '可以发起风险审核',
    })

    const stale = deriveContractCenterTaskModel({
      contract: { id: 'contract-1' },
      versions: [sourceV1, sourceV2],
      currentSourceVersionId: sourceV2.id,
      sourceIdentity: {
        state: 'ready',
        storagePath: sourceV1.storagePath,
      },
    })

    expect(stale.sourceIdentity).toMatchObject({
      state: 'stale',
      ready: false,
      canStartReview: false,
      label: '当前版本需要重新准备',
    })
  })

  it('fails closed when the explicit current-file pointer does not match any source version', () => {
    const model = deriveContractCenterTaskModel({
      contract: { id: 'contract-1' },
      versions: [sourceV1],
      currentSourceStoragePath: 'contracts/acme/unregistered.docx',
      sourceIdentity: {
        state: 'ready',
        storagePath: sourceV1.storagePath,
      },
    })

    expect(model.currentSourceVersion).toBeNull()
    expect(model.currentSourceResolution.state).toBe('conflict')
    expect(model.sourceIdentity).toMatchObject({
      state: 'stale',
      ready: false,
      canStartReview: false,
      label: '当前文件版本需要核对',
    })
  })

  it('keeps a scanned PDF waiting for OCR as an honest preparation state', () => {
    const model = deriveContractCenterTaskModel({
      contract: { id: 'contract-pdf' },
      versions: [{
        id: 'pdf-v1',
        versionNumber: 1,
        source: 'original',
        storagePath: 'contracts/acme/scanned.pdf',
      }],
      sourceIdentity: {
        state: 'waiting_ocr',
        storagePath: 'contracts/acme/scanned.pdf',
      },
    })

    expect(model.sourceIdentity).toMatchObject({
      state: 'waiting_ocr',
      ready: false,
      canStartReview: false,
    })
    expect(model.sourceIdentity.description).toContain('不会生成假审核结果')
  })

  it('keeps a legacy DOC as a preserved original instead of pretending it is review-ready', () => {
    const model = deriveContractCenterTaskModel({
      contract: { id: 'contract-doc', name: '旧版 Word 合同' },
      versions: [{
        id: 'version-doc',
        versionNumber: 1,
        source: 'original',
        storagePath: 'org/contract/source.doc',
      }],
      currentSourceVersionId: 'version-doc',
      currentSourceStoragePath: 'org/contract/source.doc',
      sourceIdentity: {
        state: 'waiting_conversion',
        ready: false,
        sourceVersionId: 'version-doc',
        storagePath: 'org/contract/source.doc',
      },
    })

    expect(model.sourceIdentity).toMatchObject({
      state: 'waiting_conversion',
      label: '原件已保留，等待可审核版本',
      ready: false,
      canStartReview: false,
    })
    expect(model.sourceIdentity.description).toContain('转换为 DOCX 后补传')
  })

  it('translates stale and failed source preparation into safe business recovery copy', () => {
    const build = (state: 'stale' | 'failed') => deriveContractCenterTaskModel({
      contract: { id: 'contract-1' },
      versions: [sourceV1],
      currentSourceVersionId: sourceV1.id,
      sourceIdentity: {
        state,
        sourceVersionId: sourceV1.id,
        failureReason: 'internal_storage_exception: bucket/path/hash',
      },
    }).sourceIdentity

    expect(build('stale')).toMatchObject({
      state: 'stale',
      label: '当前版本需要重新准备',
      canStartReview: false,
    })
    expect(build('failed')).toMatchObject({
      state: 'failed',
      label: '文件准备需要重试',
      canStartReview: false,
    })
    expect(JSON.stringify([build('stale'), build('failed')])).not.toContain('internal_storage_exception')
  })

  it('binds the latest ReviewRun to its exact source version instead of the current contract state', () => {
    const model = deriveContractCenterTaskModel({
      contract: { id: 'contract-1', name: 'ACME 服务合同' },
      versions: [sourceV1, sourceV2],
      currentSourceVersionId: sourceV2.id,
      reviewRuns: [
        {
          id: 'review-current-older',
          status: 'COMPLETED',
          sourceVersionId: sourceV2.id,
          createdAt: '2026-07-21T09:00:00.000Z',
        },
        {
          id: 'review-latest',
          status: 'ANALYZING',
          sourceStoragePath: sourceV1.storagePath,
          createdAt: '2026-07-21T10:00:00.000Z',
        },
      ],
      sourceIdentity: {
        state: 'ready',
        sourceVersionId: sourceV2.id,
      },
    })

    expect(model.latestReview).toMatchObject({
      id: 'review-latest',
      sourceBinding: 'matched_source_version',
      sourceVersionLabel: 'v1',
      isForCurrentSource: false,
      statusLabel: '审核进行中',
    })
    expect(model.currentReview).toMatchObject({
      id: 'review-current-older',
      sourceVersionLabel: 'v2',
      isForCurrentSource: true,
    })
    expect(model.latestHistoricalReview).toMatchObject({
      id: 'review-latest',
      sourceVersionLabel: 'v1',
    })
    expect(model.tasks.continue_review).toMatchObject({
      availability: 'in_progress',
      objectLabel: 'ACME 服务合同 · v1',
    })
    expect(model.tasks.continue_review.nextAction.description).toContain('当前版本与本次审核文件不同')
    expect(model.sourceIdentity).toMatchObject({
      ready: true,
      canStartReview: false,
      label: '当前版本已有审核记录',
    })
  })

  it('keeps a v1 historical review visible while leaving current ready v2 reviewable', () => {
    const model = deriveContractCenterTaskModel({
      contract: { id: 'contract-1', name: 'ACME 服务合同' },
      versions: [sourceV1, sourceV2],
      currentSourceVersionId: sourceV2.id,
      reviewRuns: [{
        id: 'review-v1',
        status: 'COMPLETED',
        sourceBinding: 'matched_source_version',
        sourceVersionId: sourceV1.id,
        sourceStoragePath: sourceV1.storagePath,
        createdAt: '2026-07-21T10:00:00.000Z',
      }],
      sourceIdentity: {
        state: 'ready',
        ready: true,
        sourceVersionId: sourceV2.id,
        storagePath: sourceV2.storagePath,
      },
    })

    expect(model.currentReview).toBeNull()
    expect(model.latestHistoricalReview).toMatchObject({
      id: 'review-v1',
      sourceVersionLabel: 'v1',
      isForCurrentSource: false,
    })
    expect(model.latestReview?.id).toBe('review-v1')
    expect(model.sourceIdentity).toMatchObject({
      state: 'ready',
      canStartReview: true,
      label: '可以发起风险审核',
    })
  })

  it('keeps every real review record in newest-first order instead of collapsing to current plus one history item', () => {
    const model = deriveContractCenterTaskModel({
      contract: { id: 'contract-1', name: 'ACME 服务合同' },
      versions: [sourceV1, sourceV2],
      currentSourceVersionId: sourceV2.id,
      reviewRuns: [
        {
          id: 'review-v1-completed',
          status: 'COMPLETED',
          sourceVersionId: sourceV1.id,
          createdAt: '2026-07-21T08:00:00.000Z',
          completedAt: '2026-07-21T08:05:00.000Z',
        },
        {
          id: 'review-v2-completed',
          status: 'COMPLETED',
          sourceVersionId: sourceV2.id,
          createdAt: '2026-07-21T09:00:00.000Z',
          completedAt: '2026-07-21T09:05:00.000Z',
        },
        {
          id: 'review-v2-running',
          status: 'ANALYZING',
          sourceVersionId: sourceV2.id,
          createdAt: '2026-07-21T10:00:00.000Z',
        },
        {
          id: 'review-source-unresolved',
          status: 'FAILED',
          createdAt: '2026-07-21T11:00:00.000Z',
        },
      ],
    })

    expect(model.reviewRuns.map((review) => review.id)).toEqual([
      'review-source-unresolved',
      'review-v2-running',
      'review-v2-completed',
      'review-v1-completed',
    ])
    expect(model.reviewRuns[0]).toMatchObject({
      sourceBinding: 'unresolved',
      sourceVersionLabel: '文件版本待核对',
      createdAt: '2026-07-21T11:00:00.000Z',
    })
    expect(model.currentReview?.id).toBe('review-v2-running')
    expect(model.latestHistoricalReview?.id).toBe('review-v1-completed')
  })

  it('does not let a sparse latest-review shortcut shadow the complete review collection row', () => {
    const model = deriveContractCenterTaskModel({
      contract: { id: 'contract-1' },
      versions: [sourceV1],
      currentSourceVersionId: sourceV1.id,
      latestReviewRun: {
        id: 'review-1',
        status: 'COMPLETED',
      },
      reviewRuns: [{
        id: 'review-1',
        status: 'COMPLETED',
        sourceVersionId: sourceV1.id,
        sourceStoragePath: sourceV1.storagePath,
        createdAt: '2026-07-21T10:00:00.000Z',
      }],
    })

    expect(model.reviewRuns).toHaveLength(1)
    expect(model.currentReview).toMatchObject({
      id: 'review-1',
      sourceBinding: 'matched_source_version',
      sourceVersionLabel: 'v1',
    })
  })

  it('selects the latest ReviewRun by creation time rather than later completion time', () => {
    const model = deriveContractCenterTaskModel({
      contract: { id: 'contract-1' },
      versions: [sourceV1, sourceV2],
      reviewRuns: [
        {
          id: 'created-first-completed-last',
          status: 'COMPLETED',
          sourceVersionId: sourceV1.id,
          createdAt: '2026-07-21T08:00:00.000Z',
          completedAt: '2026-07-21T12:00:00.000Z',
        },
        {
          id: 'created-latest',
          status: 'ANALYZING',
          sourceVersionId: sourceV2.id,
          createdAt: '2026-07-21T10:00:00.000Z',
        },
      ],
    })

    expect(model.latestReview?.id).toBe('created-latest')
    expect(model.latestReview?.sourceVersion?.id).toBe(sourceV2.id)
  })

  it('never treats an annotated output as the source of a ReviewRun', () => {
    const model = deriveContractCenterTaskModel({
      contract: { id: 'contract-1', name: 'ACME 服务合同' },
      versions: [
        sourceV1,
        {
          id: 'annotated-v2',
          versionNumber: 2,
          source: 'review_revision',
          storagePath: 'contracts/acme/annotated.docx',
        },
      ],
      latestReviewRun: {
        id: 'review-bad-binding',
        status: 'COMPLETED',
        sourceVersionId: 'annotated-v2',
      },
    })

    expect(model.latestReview).toMatchObject({
      sourceBinding: 'points_to_output_version',
      sourceVersion: null,
      sourceVersionLabel: '文件版本待核对',
    })
    expect(model.tasks.continue_review).toMatchObject({
      availability: 'available',
      blockedReason: null,
    })
    expect(model.tasks.continue_review.nextAction.label).toBe('查看审核记录并核对文件')
  })

  it('rejects conflicting ReviewRun version and file references', () => {
    const model = deriveContractCenterTaskModel({
      contract: { id: 'contract-1', name: 'ACME 服务合同' },
      versions: [sourceV1, sourceV2],
      latestReviewRun: {
        id: 'review-conflicted',
        status: 'COMPLETED',
        sourceVersionId: sourceV1.id,
        sourceStoragePath: sourceV2.storagePath,
      },
    })

    expect(model.latestReview).toMatchObject({
      sourceBinding: 'unresolved',
      sourceVersion: null,
    })
    expect(model.tasks.continue_review.nextAction.id).toBe('inspect_review_source')
  })

  it('does not let an unbound historical review block a verified current source', () => {
    const model = deriveContractCenterTaskModel({
      contract: { id: 'contract-1', name: 'ACME 服务合同' },
      versions: [sourceV1],
      sourceIdentity: {
        state: 'ready',
        sourceVersionId: sourceV1.id,
      },
      latestReviewRun: {
        id: 'review-without-source-identity',
        status: 'FAILED',
      },
    })

    expect(model.sourceIdentity).toMatchObject({
      state: 'ready',
      ready: true,
      canStartReview: true,
      label: '可以发起风险审核',
    })
    expect(model.sourceIdentity.description).toContain('旧审核记录会单独保留待核对')
    expect(model.reviewRuns[0]).toMatchObject({
      id: 'review-without-source-identity',
      sourceBinding: 'unresolved',
    })
  })

  it('translates ReviewRun status into business actions while keeping its identity', () => {
    const build = (status: string, exportReady = false) => deriveContractCenterTaskModel({
      contract: { id: 'contract-1', name: 'ACME 服务合同' },
      versions: [sourceV1],
      latestReviewRun: {
        id: `review-${status}`,
        status,
        sourceVersionId: sourceV1.id,
        exportReady,
      },
    }).tasks.continue_review

    expect(build('PARSING')).toMatchObject({
      availability: 'in_progress',
      nextAction: { id: 'view_review_progress', label: '查看审核进度' },
    })
    expect(build('FAILED')).toMatchObject({
      availability: 'available',
      nextAction: { id: 'inspect_failed_review', label: '查看失败原因并重试' },
    })
    expect(build('DEGRADED')).toMatchObject({
      availability: 'available',
      nextAction: { id: 'review_degraded_result', label: '复核降级结果' },
    })
    expect(build('COMPLETED')).toMatchObject({
      nextAction: { id: 'handle_review_risks', label: '处理审核风险' },
    })
    expect(build('COMPLETED', true)).toMatchObject({
      nextAction: { id: 'download_annotated_document', label: '下载批注版' },
    })
  })

  it('honors the API verified source binding instead of re-creating trust from IDs and paths', () => {
    const model = deriveContractCenterTaskModel({
      contract: { id: 'contract-1', name: 'ACME 服务合同' },
      versions: [sourceV1],
      currentSourceVersionId: sourceV1.id,
      latestReviewRun: {
        id: 'review-hash-mismatch',
        status: 'COMPLETED',
        sourceBinding: 'unresolved',
        sourceVersionId: sourceV1.id,
        sourceStoragePath: sourceV1.storagePath,
      },
    })

    expect(model.latestReview).toMatchObject({
      sourceBinding: 'unresolved',
      sourceVersion: null,
      statusLabel: '风险结果待处理',
    })
    expect(model.tasks.continue_review.nextAction.id).toBe('inspect_review_source')
  })

  it('does not describe a completed machine run as a completed business task', () => {
    const pendingBusinessWork = deriveContractCenterTaskModel({
      contract: { id: 'contract-1' },
      versions: [sourceV1],
      latestReviewRun: {
        id: 'review-completed',
        status: 'COMPLETED',
        sourceVersionId: sourceV1.id,
      },
    })
    const readyForDelivery = deriveContractCenterTaskModel({
      contract: { id: 'contract-1' },
      versions: [sourceV1],
      latestReviewRun: {
        id: 'review-export-ready',
        status: 'COMPLETED',
        sourceVersionId: sourceV1.id,
        exportReady: true,
      },
    })

    expect(pendingBusinessWork.latestReview?.statusLabel).toBe('风险结果待处理')
    expect(pendingBusinessWork.tasks.continue_review.nextAction.id).toBe('handle_review_risks')
    expect(readyForDelivery.latestReview?.statusLabel).toBe('审核交付已就绪')
  })

  it('uses only source-version count to decide comparison readiness', () => {
    const noVersion = deriveContractCenterTaskModel({
      contract: { id: 'contract-1', name: 'ACME 服务合同' },
      versions: [{
        id: 'annotated-v1',
        versionNumber: 1,
        source: 'review_revision',
      }],
    })
    expect(noVersion.comparison).toMatchObject({
      state: 'no_source_version',
      sourceVersionCount: 0,
      canStartComparison: false,
    })
    expect(noVersion.tasks.compare_versions).toMatchObject({
      availability: 'needs_input',
      href: '/contracts/contract-1/compare?from=workbench',
    })
    expect(noVersion.tasks.compare_versions.nextAction.label).toBe('上传源文件')

    const oneVersion = deriveContractCenterTaskModel({
      contract: { id: 'contract-1', name: 'ACME 服务合同' },
      versions: [sourceV1],
    })
    expect(oneVersion.comparison.state).toBe('needs_second_version')
    expect(oneVersion.tasks.compare_versions.nextAction.label).toBe('上传新版本')

    const twoVersions = deriveContractCenterTaskModel({
      contract: { id: 'contract-1', name: 'ACME 服务合同' },
      versions: [sourceV1, sourceV2],
    })
    expect(twoVersions.comparison).toMatchObject({
      state: 'ready',
      sourceVersionCount: 2,
      canStartComparison: true,
    })
    expect(twoVersions.tasks.compare_versions).toMatchObject({
      availability: 'available',
      blockedReason: null,
    })
    expect(twoVersions.tasks.compare_versions.nextAction.label).toBe('选择旧版与新版')
  })

  it('does not promise draft recovery before WP07 provides it', () => {
    const task = deriveContractCenterTaskModel({}).tasks.draft_contract

    expect(task.nextAction.label).toBe('开始起草')
    expect(task.nextAction.description).toContain('不承诺恢复既有草稿')
    expect(task.nextAction.label).not.toContain('继续')
  })

  it('keeps internal ReviewRun terminology out of business task copy', () => {
    const model = deriveContractCenterTaskModel({
      contract: { id: 'contract-1', name: 'ACME 服务合同' },
      versions: [sourceV1],
    })

    expect(JSON.stringify(model.tasks)).not.toContain('ReviewRun')
  })
})
