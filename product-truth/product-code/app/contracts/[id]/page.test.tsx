import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const pageSource = readFileSync(join(process.cwd(), 'app/contracts/[id]/page.tsx'), 'utf8')
const editPageSource = readFileSync(join(process.cwd(), 'app/contracts/[id]/edit/page.tsx'), 'utf8')
const reviewRouteSource = readFileSync(join(process.cwd(), 'app/api/contracts/[id]/review/route.ts'), 'utf8')
const sourceReadinessSource = readFileSync(join(process.cwd(), 'lib/contracts/contract-source-readiness.ts'), 'utf8')

describe('contract review evidence labels', () => {
  it('shows rule acceptance, model-quality gold and runtime invocation as separate facts', () => {
    expect(pageSource).toContain('label="规则验收"')
    expect(pageSource).toContain('skill_bundle?.rule_acceptance_status')
    expect(pageSource).toContain('label="模型质量金标"')
    expect(pageSource).toContain('skill_bundle?.model_quality_eval_status')
    expect(pageSource).toContain('label="本次语义模型调用"')
    expect(pageSource).toContain('skill_bundle?.runtime_invocation_status')
  })

  it('does not present reference evidence or provider execution as the publication gate', () => {
    expect(pageSource).not.toContain('label="发布门禁"')
    expect(pageSource).not.toContain('skill_bundle?.static_eval_status')
    expect(pageSource).not.toContain('skill_bundle?.runtime_eval_status')
  })

  it('derives the panel from reactive URL state and routes every explicit panel choice', () => {
    expect(pageSource).toContain("const requestedPanel = searchParams.get('panel')")
    expect(pageSource).toContain('const sidePanelMode = normalizeContractWorkbenchPanel(requestedPanel)')
    expect(pageSource).toContain('buildContractWorkbenchPanelHref(contractId, currentSearch, nextPanel)')
    expect(pageSource).toContain('if (nextHref === currentHref) return')
    expect(pageSource).toContain('onChange={handleSidePanelModeChange}')
    expect(pageSource).toContain('onModeChange={handleSidePanelModeChange}')
    expect(pageSource).not.toContain('new URLSearchParams(window.location.search)')
  })

  it('keeps model routing and review strategy out of the business workbench', () => {
    expect(pageSource).not.toContain('reviewStyle')
    expect(pageSource).not.toContain('reviewStyleStrategy')
    expect(pageSource).not.toContain("strategy: reviewStyleStrategy")
    expect(pageSource).not.toContain("label: '严审'")
    expect(pageSource).not.toContain("label: '均衡'")
    expect(pageSource).not.toContain("label: '商务'")
  })

  it('turns an unreadable source into a visible recovery task and blocks ReviewRun creation', () => {
    expect(reviewRouteSource).toContain('deriveContractSourceReadiness')
    expect(reviewRouteSource).toContain('source_identity: sourceIdentity')
    expect(pageSource).toContain('data.source_identity?.can_start_review')
    expect(pageSource).toContain('sourcePreparation.recoveryAction.href')
    expect(pageSource).toContain('Boolean(data.source_identity?.can_start_review)')
    expect(pageSource).not.toContain("data.currentVersion?.ingest_status === 'AWAITING_OCR'")
    expect(pageSource).not.toContain("data.currentVersion?.ingest_status === 'AWAITING_CONVERSION'")
    expect(sourceReadinessSource).toContain("'supply_searchable_pdf'")
    expect(sourceReadinessSource).toContain("'supply_docx'")
    expect(sourceReadinessSource).toContain('intent=source-replacement')
    expect(editPageSource).toContain("intent === 'source-replacement'")
    expect(editPageSource).toContain("不会在上传页偷偷启动审核")
  })

  it('treats only the current version review as rerunnable and fences a first v2 review', () => {
    expect(pageSource).toContain('const isRerun = Boolean(data.has_current_review)')
    expect(pageSource).toContain('expected_upload_id: currentUploadId')
    expect(pageSource).toContain('expected_file_sha256: currentFileHash')
    expect(pageSource).toContain('data.currentVersion?.upload_id')
    expect(pageSource).toContain('data.currentVersion?.file_sha256')
    expect(pageSource).not.toContain("data.status === 'COMPLETED' || data.status === 'FAILED' || Boolean(data.reviewRun?.id)")
  })

  it('keeps explicit historical review facts separate from the current source version', () => {
    expect(pageSource).toContain("const requestedReviewId = searchParams.get('review')")
    expect(pageSource).toContain("if (requestedReviewId) query.set('review', requestedReviewId)")
    expect(pageSource).toContain("data.review_context === 'historical'")
    expect(pageSource).toContain('本页风险、处理记录和审核依据只属于')
    expect(pageSource).toContain('不会作为 {currentVersionLabel} 的审核结果')
    expect(pageSource).toContain('data.reviewedVersion')
  })

  it('keeps platform evidence terms out of primary business copy', () => {
    expect(pageSource).toContain('装载对应版本的审核记录')
    expect(pageSource).toContain('审核依据和执行记录正在后台补齐')
    expect(pageSource).toContain('确认正文、文件身份和风险定位完成前不会发起审核')
    expect(pageSource).not.toContain('装载最近一次 ReviewRun')
    expect(pageSource).not.toContain('长任务会持续刷新；请等待风险定位、模型调用和批注意图完成')
    expect(pageSource).not.toContain('规则快照、SkillBundle、模型调用和批注意图门禁')
    expect(pageSource).not.toContain('完成前系统不会创建 ReviewRun')
  })

  it('lists every review history item and only links records with verified source identity', () => {
    expect(pageSource).toContain('const reviewHistory = data.review_history || []')
    expect(pageSource).toContain('reviewHistory.map((review) =>')
    expect(pageSource).toContain('共 {reviewHistory.length} 次')
    expect(pageSource).toContain('review.source_identity_verified')
    expect(pageSource).toContain('review=${encodeURIComponent(review.id)}')
    expect(pageSource).toContain('确认文件版本后可查看')
    expect(pageSource).not.toContain('review.id.slice(0, 8)')
  })
})
