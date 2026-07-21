import type { AIOutputValidation } from '@/lib/ai/runtime-executor'

export function validateContractChatOutput(text: string): AIOutputValidation<string> {
  const value = text.trim()
  if (value.length < 8) return { ok: false, error: '回复过短，不能形成可用答复' }
  if (value.length > 8000) return { ok: false, error: '回复超过 8000 字' }
  if (/<(?:think|reasoning)>/i.test(value)) {
    return { ok: false, error: '回复泄露模型推理标记' }
  }
  return { ok: true, value }
}

export function validateGeneratedContractOutput(
  text: string,
  input: { partyA: string; partyB: string },
): AIOutputValidation<string> {
  const value = text.trim()
  if (value.length < 200) return { ok: false, error: '合同正文少于 200 字' }
  if (value.length > 200_000) return { ok: false, error: '合同正文超过 200000 字' }
  if (/^```|```$/.test(value) || /^\s*[\[{]/.test(value)) {
    return { ok: false, error: '模型输出不是纯合同正文' }
  }
  if (!value.includes(input.partyA) || !value.includes(input.partyB)) {
    return { ok: false, error: '合同正文缺少请求中的签约主体' }
  }
  const sectionSignals = ['标的', '价款', '付款', '履行', '交付', '违约', '争议', '签署']
    .filter((signal) => value.includes(signal))
  if (sectionSignals.length < 4) {
    return { ok: false, error: '合同正文缺少必要条款结构' }
  }
  if (/<(?:think|reasoning)>/i.test(value)) {
    return { ok: false, error: '合同正文泄露模型推理标记' }
  }
  return { ok: true, value }
}
