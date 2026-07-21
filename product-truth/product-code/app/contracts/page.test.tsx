import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deriveContractCenterTaskModel } from '@/lib/contracts/contract-center-task-model'

const pageSource = readFileSync(join(process.cwd(), 'app/contracts/page.tsx'), 'utf8')
const contractTasksStart = pageSource.indexOf('const contractTasks = contracts.flatMap')
const contractTasksEnd = pageSource.indexOf('const compareTasks = contracts.flatMap', contractTasksStart)
const contractTasksSource = pageSource.slice(contractTasksStart, contractTasksEnd)
const reviewPresentationStart = pageSource.indexOf('function reviewTaskPresentation')
const reviewPresentationEnd = pageSource.indexOf('const taskPresentation', reviewPresentationStart)
const reviewPresentationSource = pageSource.slice(reviewPresentationStart, reviewPresentationEnd)
const launchPanelStart = pageSource.indexOf('function ReviewLaunchPanel')
const launchPanelEnd = pageSource.indexOf('function StatCard', launchPanelStart)
const launchPanelSource = pageSource.slice(launchPanelStart, launchPanelEnd)

describe('contract center business task entry', () => {
  it('renders the four fixed business tasks in model order', () => {
    expect(pageSource).toContain('globalModel.taskOrder.map')
    const taskPositions = [
      'draft_contract:',
      'start_review:',
      'continue_review:',
      'compare_versions:',
    ].map((task) => pageSource.indexOf(task))

    expect(taskPositions.every((position) => position > -1)).toBe(true)
    expect(taskPositions).toEqual([...taskPositions].sort((left, right) => left - right))
    expect(launchPanelSource).toContain('xl:grid-cols-4')
  })

  it('derives review-list actions from source identity and every review record, never Contract.status', () => {
    expect(contractTasksStart).toBeGreaterThan(-1)
    expect(contractTasksSource).toContain('const model = buildTaskModel(c)')
    expect(contractTasksSource).toContain('model.currentReview')
    expect(contractTasksSource).toContain('model.reviewRuns.map')
    expect(contractTasksSource).toContain('model.sourceIdentity')
    expect(contractTasksSource).not.toContain('c.status')
    expect(contractTasksSource).not.toContain('statusMap')
    expect(contractTasksSource).not.toContain("|| continueTask.nextAction.id === 'handle_review_risks'")
    expect(pageSource).not.toContain('deriveReviewWorkflowState')
  })

  it('does not silently select the most recent completed contract for comparison', () => {
    expect(pageSource).not.toContain('compareTarget')
    expect(pageSource).not.toContain("find((contract) => contract.status === 'COMPLETED')")
    expect(pageSource).toContain('const compareTasks = contracts.flatMap')
    expect(pageSource).toContain('const compareTask = model.tasks.compare_versions')

    const globalModel = deriveContractCenterTaskModel({})
    expect(globalModel.tasks.compare_versions).toMatchObject({
      availability: 'blocked',
      href: null,
    })
    expect(globalModel.tasks.compare_versions.blockedReason).toContain('不会替你猜测')
  })

  it('does not count an unused comparison capability as a pending business task', () => {
    expect(pageSource).toContain('const compareTasks = contracts.flatMap')
    expect(pageSource).toContain('const compareChoices = useMemo')
    expect(pageSource).toContain('selectionOnly: true')
    expect(pageSource).toContain("{task.selectionOnly ? '选择：' : '任务：'}")
    expect(pageSource).not.toContain("id: `${contract.id}:compare:prepare`")
  })

  it('keeps old draft records visible without promising unsupported recovery', () => {
    const draftStart = pageSource.indexOf('const draftTasks = drafts.map')
    const draftEnd = pageSource.indexOf('const contractTasks = contracts.flatMap', draftStart)
    const draftSource = pageSource.slice(draftStart, draftEnd)

    expect(draftSource).toContain("status: '暂不可继续'")
    expect(draftSource).toContain('href: null')
    expect(draftSource).toContain("nextAction: '开始一份新草稿'")
    expect(draftSource).not.toContain('继续起草')
    expect(draftSource).not.toContain('/contracts/draft?id=')
  })

  it('uses only source versions for displayed version and comparison readiness', () => {
    expect(pageSource).toContain('source: version.source')
    expect(pageSource).toContain('model.sourceVersions.find')
    expect(pageSource).toContain('model.comparison.sourceVersionCount')
    expect(pageSource).not.toContain('contractVersionLabel')
  })

  it('separates organization, search, and filter empty states', () => {
    expect(pageSource).toContain("? 'search' as const")
    expect(pageSource).toContain("? 'organization' as const")
    expect(pageSource).toContain("mode: 'organization' | 'search' | 'filter'")
    expect(pageSource).toContain('还没有合同或草稿')
    expect(pageSource).toContain('没有找到“${query}”')
    expect(pageSource).toContain('当前分类没有任务')
    expect(pageSource).toContain('onClearSearch')
    expect(pageSource).toContain('onResetFilter')
  })

  it('keeps the primary task cards business-readable', () => {
    expect(launchPanelSource).toContain('开始前：')
    expect(launchPanelSource).toContain('下一步')
    expect(launchPanelSource).toContain('action.outcomeLabel')
    expect(launchPanelSource).not.toContain('{index + 1}')
    expect(launchPanelSource).not.toContain('ReviewRun')
    expect(launchPanelSource).not.toContain('SkillBundle')
    expect(launchPanelSource).not.toContain('ModelPolicy')
    expect(launchPanelSource).not.toContain('storage_path')
  })

  it('uses global tasks to filter explicit choices instead of choosing a contract', () => {
    expect(pageSource).toContain("setTaskFilter(taskId === 'continue_review' ? 'reviewed' : 'compare')")
    expect(pageSource).toContain("href: '#contract-task-list'")
    expect(pageSource).toContain("taskFilter === 'reviewed'")
    expect(pageSource).not.toContain('router.push(`/contracts/${reviewedContracts[0]')
    expect(pageSource).not.toContain('contractsWithSources[0]')
  })

  it('does not treat the first page as the whole organization when more contracts exist', () => {
    expect(pageSource).toContain("id === 'continue_review' && hasNext")
    expect(pageSource).toContain('当前页没有审核记录，但后续还有合同')
    expect(pageSource).toContain('moreContractsMayHaveSources')
    expect(pageSource).toContain('当前页没有源版本，但后续还有合同')
  })

  it('keeps review entry URLs panel-neutral', () => {
    const model = deriveContractCenterTaskModel({
      contract: { id: 'contract-1', name: '测试合同' },
      versions: [{
        id: 'source-v1',
        versionNumber: 1,
        source: 'original',
        storagePath: 'contracts/test/v1.docx',
      }],
      latestReviewRun: {
        id: 'review-1',
        status: 'ANALYZING',
        sourceVersionId: 'source-v1',
      },
    })
    const url = new URL(model.tasks.continue_review.href!, 'https://price-v3.test')

    expect(url.pathname).toBe('/contracts/contract-1')
    expect(url.searchParams.get('from')).toBe('list')
    expect(url.searchParams.has('panel')).toBe(false)
  })

  it('declares the list API facts needed by the task model', () => {
    expect(pageSource).toContain('storage_path?: string | null')
    expect(pageSource).toContain('current_version_id?: string | null')
    expect(pageSource).toContain('latest_review?: ContractReviewSummary | null')
    expect(pageSource).toContain('review_runs?: ContractReviewSummary[]')
    expect(pageSource).toContain("source_binding?: 'matched_source_version'")
    expect(pageSource).toContain('sourceBinding: latestReview.source_binding')
    expect(pageSource).toContain('contract_version_id?: string | null')
    expect(pageSource).toContain('source_storage_path?: string | null')
    expect(pageSource).toContain('source_identity?: ContractSourceIdentitySummary | null')
    expect(pageSource).toContain('can_start_review?: boolean | null')
    expect(pageSource).toContain('recovery_action?:')
    expect(pageSource).not.toContain('latest_review_run?:')
    expect(pageSource).not.toContain('current_source_identity?:')
  })

  it('renders every review record and keeps an unreviewed current version as a separate business task', () => {
    expect(contractTasksSource).toContain("id: `${c.id}:review:current-unreviewed`")
    expect(contractTasksSource).toContain('const reviewTasks = model.reviewRuns.map')
    expect(contractTasksSource).toContain("id: `${c.id}:review:${review.id}`")
    expect(contractTasksSource).toContain('历史审核，不影响当前')
    expect(contractTasksSource).toContain('审核当前 ${model.currentSourceVersionLabel}')
    expect(contractTasksSource).toContain('review=${encodeURIComponent(review.id)}')
    expect(contractTasksSource).toContain('return model.sourceIdentity.ready && currentReview')
    expect(contractTasksSource).toContain(': [currentUnreviewedTask, ...reviewTasks]')
    expect(contractTasksSource).toContain("!sourceVerified")
    expect(contractTasksSource).toContain("label: '打开合同核对来源'")
    expect(contractTasksSource).toContain(": `/contracts/${encodeURIComponent(c.id)}?from=list`,")
    expect(contractTasksSource).not.toContain('const hasReview = Boolean(model.latestReview)')
  })

  it('does not count a completed machine run as completed business work', () => {
    expect(reviewPresentationSource).toContain("['completed', 'succeeded', 'success', 'done']")
    expect(reviewPresentationSource).toContain("action: '处理审核风险'")
    expect(reviewPresentationSource).toContain("stateGroup: 'pending' as const")
    expect(reviewPresentationSource).not.toContain("stateGroup: 'completed' as const")
  })

  it('shows user actions instead of fake progress for blocked source formats', () => {
    expect(contractTasksSource).toContain('const sourceRecoveryAction = c.source_identity?.recovery_action')
    expect(contractTasksSource).toContain('label: sourceRecoveryAction.label')
    expect(contractTasksSource).toContain('description: sourceRecoveryAction.description || model.sourceIdentity.description')
    expect(contractTasksSource).toContain('href: sourceRecoveryAction?.href')
    expect(contractTasksSource).not.toContain("sourceState === 'waiting_ocr'")
    expect(contractTasksSource).not.toContain("sourceState === 'waiting_conversion'")
  })
})
