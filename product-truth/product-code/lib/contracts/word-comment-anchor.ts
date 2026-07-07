const MIN_WORD_COMMENT_ANCHOR_LENGTH = 6

function normalizeCandidate(value: string) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

export function wordCommentAnchorCandidates(value: string | null | undefined) {
  const source = normalizeCandidate(String(value || ''))
  if (!source) return []

  const rawCandidates = source.includes('\n') || source.includes('\r')
    ? source.split(/\r?\n+/)
    : [source]

  return Array.from(new Set(rawCandidates
    .map(normalizeCandidate)
    .filter((candidate) => candidate.length >= MIN_WORD_COMMENT_ANCHOR_LENGTH)
    .filter((candidate) => !/[\r\n]/.test(candidate))))
}

export function hasUsableWordCommentAnchor(value: string | null | undefined) {
  return wordCommentAnchorCandidates(value).length > 0
}
