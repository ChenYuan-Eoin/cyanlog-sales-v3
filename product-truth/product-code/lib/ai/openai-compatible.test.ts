import { describe, expect, it } from 'vitest'
import { normalizeOpenAICompatibleBaseUrl, openAICompatibleModelsUrl } from './openai-compatible'

describe('OpenAI-compatible base URL helpers', () => {
  it('normalizes root provider URLs to the /v1 API base', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://cloud.yiyongai.cn')).toBe('https://cloud.yiyongai.cn/v1')
    expect(normalizeOpenAICompatibleBaseUrl('https://cloud.yiyongai.cn/')).toBe('https://cloud.yiyongai.cn/v1')
  })

  it('preserves explicit API paths', () => {
    expect(normalizeOpenAICompatibleBaseUrl('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1')
    expect(normalizeOpenAICompatibleBaseUrl('https://gateway.example.com/openai/v1')).toBe('https://gateway.example.com/openai/v1')
  })

  it('builds a normalized models endpoint URL', () => {
    expect(String(openAICompatibleModelsUrl('https://cloud.yiyongai.cn'))).toBe('https://cloud.yiyongai.cn/v1/models')
  })
})
