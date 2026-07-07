export type DocumentLocatorMode = 'clause' | 'fragment' | 'missing'

export type DocumentLocator = {
  mode: DocumentLocatorMode
  clauseLabel: string
  pageLabel: string
  evidencePreview: string
}

const MAX_PREVIEW_LENGTH = 96

function compactText(value: string | null | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function truncate(value: string, maxLength = MAX_PREVIEW_LENGTH) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}...`
}

export function inferDocumentLocator(selectedText: string | null | undefined): DocumentLocator {
  const evidencePreview = truncate(compactText(selectedText))

  if (!evidencePreview) {
    return {
      mode: 'missing',
      clauseLabel: '未选择证据',
      pageLabel: '待定位页',
      evidencePreview: '',
    }
  }

  const articleMatch = evidencePreview.match(/第\s*([一二三四五六七八九十百千万零〇两\d]+)\s*([条款章节])/)
  if (articleMatch) {
    return {
      mode: 'clause',
      clauseLabel: `第${articleMatch[1]}${articleMatch[2]}`,
      pageLabel: '页码随原件预览确认',
      evidencePreview,
    }
  }

  const decimalClauseMatch = evidencePreview.match(/(?:^|[\s，。；;、])(\d+(?:\.\d+){1,3})(?=[\s，。；;、)）]|$)/)
  if (decimalClauseMatch) {
    return {
      mode: 'clause',
      clauseLabel: `${decimalClauseMatch[1]} 条款`,
      pageLabel: '页码随原件预览确认',
      evidencePreview,
    }
  }

  const listMatch = evidencePreview.match(/(?:^|[\s，。；;])([一二三四五六七八九十]+)[、.．]/)
  if (listMatch) {
    return {
      mode: 'clause',
      clauseLabel: `${listMatch[1]}、条款段落`,
      pageLabel: '页码随原件预览确认',
      evidencePreview,
    }
  }

  return {
    mode: 'fragment',
    clauseLabel: '条款片段',
    pageLabel: '页码需原件渲染确认',
    evidencePreview,
  }
}
