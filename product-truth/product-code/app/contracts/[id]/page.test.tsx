import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const pageSource = readFileSync(join(process.cwd(), 'app/contracts/[id]/page.tsx'), 'utf8')

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
})
