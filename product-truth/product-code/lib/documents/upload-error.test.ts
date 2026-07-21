import { describe, expect, it } from 'vitest'
import { readUploadErrorMessage, uploadErrorMessage } from './upload-error'

describe('upload error messages', () => {
  it('reads legacy flat errors', () => {
    expect(uploadErrorMessage({ error: '文件过大' }, '上传失败')).toBe('文件过大')
  })

  it('reads standard structured API errors', () => {
    expect(uploadErrorMessage({
      success: false,
      error: { code: 'S003', message: '身份服务暂时不可用，请重试' },
    }, '上传失败')).toBe('身份服务暂时不可用，请重试')
  })

  it('falls back for malformed and non-JSON responses', async () => {
    expect(uploadErrorMessage({ error: {} }, '上传失败')).toBe('上传失败')
    const response = new Response('<html>gateway error</html>')
    expect(await readUploadErrorMessage(response, '网络服务异常')).toBe('网络服务异常')
  })
})
