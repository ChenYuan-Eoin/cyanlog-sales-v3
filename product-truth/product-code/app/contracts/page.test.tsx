import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deriveReviewWorkflowState, type ReviewStateInput } from '@/lib/contracts/review-state-machine'
import { buildContractListReviewNavigation } from '@/lib/contracts/review-navigation'

const pageSource = readFileSync(join(process.cwd(), 'app/contracts/page.tsx'), 'utf8')
const contractTasksStart = pageSource.indexOf('const contractTasks = contracts.map')
const contractTasksEnd = pageSource.indexOf('const compareTasks = contracts.flatMap', contractTasksStart)
const contractTasksSource = pageSource.slice(contractTasksStart, contractTasksEnd)

const workflowCases: Array<{ label: string; input: ReviewStateInput }> = [
  { label: '缺少源文件', input: { status: 'DRAFT', hasSourceAsset: false } },
  { label: '已上传待审核', input: { status: 'PENDING', hasSourceAsset: true } },
  { label: '解析中', input: { status: 'PARSING', hasSourceAsset: true } },
  { label: '审核中', input: { status: 'ANALYZING', hasSourceAsset: true } },
  { label: '审核失败', input: { status: 'FAILED', hasSourceAsset: true } },
  {
    label: '审核完成且可导出',
    input: {
      status: 'COMPLETED',
      hasSourceAsset: true,
      hasReviewArtifacts: true,
      exportReady: true,
    },
  },
  {
    label: '审核完成但导出受阻',
    input: {
      status: 'COMPLETED',
      hasSourceAsset: true,
      hasReviewArtifacts: true,
      exportReady: false,
      exportBlockedReasons: ['存在待人工定位的批注意图'],
    },
  },
  {
    label: '审核完成但详情仍在装载',
    input: {
      status: 'COMPLETED',
      hasSourceAsset: true,
      payloadScope: 'summary',
    },
  },
  { label: '未知历史状态', input: { status: 'UNKNOWN', hasSourceAsset: true } },
]

describe('contract list review entry', () => {
  it('separates runtime next-action state from the user-selected entry panel', () => {
    expect(contractTasksStart).toBeGreaterThan(-1)
    expect(contractTasksSource).toContain('buildContractListReviewNavigation(c.id, workflowState)')
    expect(contractTasksSource).not.toContain('workflowState.detailPanel')
    expect(contractTasksSource).not.toContain("panel: 'evidence'")
  })

  it.each(workflowCases)('keeps $label panel-neutral while preserving its next action', ({ input }) => {
    const workflowState = deriveReviewWorkflowState(input)
    const navigation = buildContractListReviewNavigation('contract-1', workflowState)
    const url = new URL(navigation.href, 'https://price-v3.test')

    expect(url.pathname).toBe('/contracts/contract-1')
    expect(url.searchParams.get('from')).toBe('list')
    expect(url.searchParams.has('panel')).toBe(false)
    expect(navigation.nextAction).toBe(workflowState.nextActionLabel)
    expect(navigation.nextActionDescription).toBe(workflowState.nextActionDescription)
  })
})
