import { describe, expect, it } from 'vitest'

import {
  validateContractChatOutput,
  validateGeneratedContractOutput,
} from './business-output-validation'

describe('business AI output validators', () => {
  it('accepts a useful contract answer and rejects empty/reasoning output', () => {
    expect(validateContractChatOutput('根据第十条，付款期限为验收后 30 日。')).toEqual({
      ok: true,
      value: '根据第十条，付款期限为验收后 30 日。',
    })
    expect(validateContractChatOutput('不确定')).toMatchObject({ ok: false })
    expect(validateContractChatOutput('<think>secret</think>根据条款回答')).toMatchObject({ ok: false })
  })

  it('requires a plain, sufficiently complete contract containing both parties', () => {
    const valid = [
      '系统服务协议',
      '甲方：甲方公司',
      '乙方：乙方公司',
      '第一条 合同标的：乙方向甲方提供系统服务。',
      '第二条 价款与付款：服务价款按附件执行，甲方应按约付款。',
      '第三条 履行与交付：乙方按里程碑交付。',
      '第四条 违约责任：违约方承担相应责任。',
      '第五条 争议解决：双方协商，协商不成依法诉讼。',
      '第六条 签署：双方盖章后生效。',
      '其他约定：本协议一式两份，甲乙双方各执一份。'.repeat(5),
    ].join('\n')

    expect(validateGeneratedContractOutput(valid, {
      partyA: '甲方公司', partyB: '乙方公司',
    })).toEqual({ ok: true, value: valid })
    expect(validateGeneratedContractOutput(valid.replace('乙方公司', '第三方'), {
      partyA: '甲方公司', partyB: '乙方公司',
    })).toMatchObject({ ok: false, error: expect.stringContaining('签约主体') })
    expect(validateGeneratedContractOutput(`{${valid}}`, {
      partyA: '甲方公司', partyB: '乙方公司',
    })).toMatchObject({ ok: false, error: expect.stringContaining('纯合同正文') })
  })
})
