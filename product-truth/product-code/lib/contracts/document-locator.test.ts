import { describe, expect, it } from 'vitest'
import { inferDocumentLocator } from './document-locator'

describe('document locator', () => {
  it('extracts Chinese article labels without inventing a page number', () => {
    expect(inferDocumentLocator('第二条 权利与义务约定，甲方应当按期付款')).toMatchObject({
      mode: 'clause',
      clauseLabel: '第二条',
      pageLabel: '页码随原件预览确认',
    })
  })

  it('extracts decimal clause labels from evidence text', () => {
    expect(inferDocumentLocator('2.1 主合同项下的产品标准、服务条款、价格政策')).toMatchObject({
      mode: 'clause',
      clauseLabel: '2.1 条款',
    })
  })

  it('falls back to a fragment locator when only text evidence is available', () => {
    expect(inferDocumentLocator('客户数据归客户，ONES 受限处理')).toMatchObject({
      mode: 'fragment',
      clauseLabel: '条款片段',
      pageLabel: '页码需原件渲染确认',
    })
  })

  it('keeps missing evidence explicit', () => {
    expect(inferDocumentLocator('   ')).toEqual({
      mode: 'missing',
      clauseLabel: '未选择证据',
      pageLabel: '待定位页',
      evidencePreview: '',
    })
  })
})
