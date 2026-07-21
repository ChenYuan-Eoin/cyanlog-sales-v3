import { describe, expect, it } from 'vitest'
import { clientApiErrorMessage } from './client-api-error'

describe('clientApiErrorMessage', () => {
  it('reads the structured API error envelope', () => {
    expect(clientApiErrorMessage({
      success: false,
      error: { code: 'S001', message: '源文件提交失败，请重试同一文件' },
    }, '上传失败')).toBe('源文件提交失败，请重试同一文件')
  })

  it('keeps compatibility with flat legacy errors', () => {
    expect(clientApiErrorMessage({ error: '合同不存在' }, '上传失败')).toBe('合同不存在')
  })

  it('never returns an object to React', () => {
    expect(clientApiErrorMessage({ error: { code: 'S001' } }, '上传失败')).toBe('上传失败')
    expect(clientApiErrorMessage(null, '网络错误')).toBe('网络错误')
  })
})
