import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const pageSource = readFileSync(join(process.cwd(), 'app/contracts/new/page.tsx'), 'utf8')
const sourceReadinessSource = readFileSync(join(process.cwd(), 'lib/contracts/contract-source-readiness.ts'), 'utf8')

describe('new contract review business entry', () => {
  it('does not expose a review-style control whose behavior is not implemented', () => {
    expect(pageSource).not.toContain('reviewStyleOptions')
    expect(pageSource).not.toContain('reviewStyleStrategy')
    expect(pageSource).not.toContain('审核风格')
    expect(pageSource).toContain('系统按组织已发布的合同规则集判断风险')
    expect(pageSource).toContain('这里无需选择具体模型')
  })

  it('lets the published business configuration drive the initial review', () => {
    expect(pageSource).toContain('expected_upload_id: source.uploadId')
    expect(pageSource).toContain('expected_file_sha256: source.fileSha256')
    expect(pageSource).not.toContain("body: JSON.stringify({ strategy:")
  })

  it('persists the create request before POST and binds recovery to auth and file bytes', () => {
    expect(pageSource).toContain('clientRequestId: crypto.randomUUID()')
    expect(pageSource).toContain('client_request_id: intent.clientRequestId')
    expect(pageSource.indexOf('persistRecoverySession(session)')).toBeLessThan(
      pageSource.indexOf('session = await createContract(file, token, session)')
    )
    expect(pageSource).toContain('session.fileSha256 === fileSha256')
    expect(pageSource).toContain('session.authScopeHash === authScopeHash')
    expect(pageSource).toContain('finalized.sha256 !== session.fileSha256')
  })

  it('shows saved legacy DOC as a conversion task instead of reverting to waiting upload', () => {
    expect(pageSource).toContain("stage === 'awaiting_ocr' || stage === 'awaiting_conversion'")
    expect(pageSource).toContain("? '需要转换为 DOCX'")
    expect(pageSource).toContain('currentIndex === index && (active || requiresSourcePreparation)')
    expect(pageSource).toContain('disabled={!file || loading || Boolean(notice)}')
    expect(pageSource).toContain('intent=source-replacement')
  })

  it('uses one visible format contract for DOC, DOCX, DOCM and PDF', () => {
    expect(pageSource).toContain("const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.docm']")
    expect(pageSource).toContain('CONTRACT_SOURCE_FORMAT_LABEL')
    expect(sourceReadinessSource).toContain("'Word（DOC、DOCX、DOCM）或 PDF'")
  })
})
