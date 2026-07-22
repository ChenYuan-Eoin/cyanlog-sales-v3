export type DocumentDiffType = 'added' | 'deleted' | 'modified'

export interface DocumentDiffPosition {
  start_offset_utf16: number
  end_offset_utf16: number
  start_line: number
  end_line: number
  normalized_progress: number
}

export interface DocumentDiffHunk {
  id: string
  diff_type: DocumentDiffType
  baseline_text: string
  compare_text: string
  baseline_position: DocumentDiffPosition
  compare_position: DocumentDiffPosition
  sort_order: number
}

interface LineSegment {
  start: number
  end: number
  line: number
  normalized: string
}

interface LcsMatch {
  baseline: number
  compare: number
}

function normalizeLine(value: string) {
  return value
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function segmentDocument(text: string): LineSegment[] {
  const segments: LineSegment[] = []
  let cursor = 0
  let line = 1

  while (cursor < text.length) {
    let contentEnd = cursor
    while (contentEnd < text.length && text[contentEnd] !== '\n' && text[contentEnd] !== '\r') {
      contentEnd += 1
    }

    const normalized = normalizeLine(text.slice(cursor, contentEnd))
    if (normalized) {
      segments.push({ start: cursor, end: contentEnd, line, normalized })
    }

    if (contentEnd >= text.length) break
    cursor = contentEnd + (text[contentEnd] === '\r' && text[contentEnd + 1] === '\n' ? 2 : 1)
    line += 1
  }

  return segments
}

function countLines(text: string) {
  let lines = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\r') {
      if (text[index + 1] === '\n') index += 1
      lines += 1
    } else if (text[index] === '\n') {
      lines += 1
    }
  }
  return lines
}

function lcsPrefixLengths(
  baseline: readonly LineSegment[],
  baselineStart: number,
  baselineEnd: number,
  compare: readonly LineSegment[],
  compareStart: number,
  compareEnd: number
) {
  const compareLength = compareEnd - compareStart
  let previous = new Uint32Array(compareLength + 1)
  let current = new Uint32Array(compareLength + 1)

  for (let baselineIndex = baselineStart; baselineIndex < baselineEnd; baselineIndex += 1) {
    current[0] = 0
    for (let compareOffset = 1; compareOffset <= compareLength; compareOffset += 1) {
      current[compareOffset] = baseline[baselineIndex].normalized === compare[compareStart + compareOffset - 1].normalized
        ? previous[compareOffset - 1] + 1
        : Math.max(previous[compareOffset], current[compareOffset - 1])
    }
    ;[previous, current] = [current, previous]
  }

  return previous
}

function lcsSuffixLengths(
  baseline: readonly LineSegment[],
  baselineStart: number,
  baselineEnd: number,
  compare: readonly LineSegment[],
  compareStart: number,
  compareEnd: number
) {
  const compareLength = compareEnd - compareStart
  let previous = new Uint32Array(compareLength + 1)
  let current = new Uint32Array(compareLength + 1)

  for (let baselineIndex = baselineEnd - 1; baselineIndex >= baselineStart; baselineIndex -= 1) {
    current[compareLength] = 0
    for (let compareOffset = compareLength - 1; compareOffset >= 0; compareOffset -= 1) {
      current[compareOffset] = baseline[baselineIndex].normalized === compare[compareStart + compareOffset].normalized
        ? previous[compareOffset + 1] + 1
        : Math.max(previous[compareOffset], current[compareOffset + 1])
    }
    ;[previous, current] = [current, previous]
  }

  return previous
}

/** Hirschberg LCS keeps memory linear while retaining deterministic duplicate handling. */
function collectLcsMatches(
  baseline: readonly LineSegment[],
  baselineStart: number,
  baselineEnd: number,
  compare: readonly LineSegment[],
  compareStart: number,
  compareEnd: number
): LcsMatch[] {
  const baselineLength = baselineEnd - baselineStart
  const compareLength = compareEnd - compareStart
  if (baselineLength === 0 || compareLength === 0) return []

  if (baselineLength === 1) {
    for (let index = compareStart; index < compareEnd; index += 1) {
      if (baseline[baselineStart].normalized === compare[index].normalized) {
        return [{ baseline: baselineStart, compare: index }]
      }
    }
    return []
  }

  if (compareLength === 1) {
    for (let index = baselineStart; index < baselineEnd; index += 1) {
      if (baseline[index].normalized === compare[compareStart].normalized) {
        return [{ baseline: index, compare: compareStart }]
      }
    }
    return []
  }

  const baselineMiddle = baselineStart + Math.floor(baselineLength / 2)
  const prefix = lcsPrefixLengths(
    baseline,
    baselineStart,
    baselineMiddle,
    compare,
    compareStart,
    compareEnd
  )
  const suffix = lcsSuffixLengths(
    baseline,
    baselineMiddle,
    baselineEnd,
    compare,
    compareStart,
    compareEnd
  )

  let bestScore = -1
  let compareSplitOffset = 0
  for (let offset = 0; offset <= compareLength; offset += 1) {
    const score = prefix[offset] + suffix[offset]
    // Keeping the first maximum makes repeated-line pairing stable and leftmost.
    if (score > bestScore) {
      bestScore = score
      compareSplitOffset = offset
    }
  }
  const compareMiddle = compareStart + compareSplitOffset

  return [
    ...collectLcsMatches(baseline, baselineStart, baselineMiddle, compare, compareStart, compareMiddle),
    ...collectLcsMatches(baseline, baselineMiddle, baselineEnd, compare, compareMiddle, compareEnd),
  ]
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function positionForRange(
  text: string,
  segments: readonly LineSegment[],
  startIndex: number,
  endIndex: number
): DocumentDiffPosition {
  if (endIndex > startIndex) {
    const first = segments[startIndex]
    const last = segments[endIndex - 1]
    const midpoint = first.start + (last.end - first.start) / 2
    return {
      start_offset_utf16: first.start,
      end_offset_utf16: last.end,
      start_line: first.line,
      end_line: last.line,
      normalized_progress: clampProgress(midpoint / Math.max(1, text.length)),
    }
  }

  const next = segments[startIndex]
  const offset = next ? next.start : segments.length === 0 ? 0 : text.length
  const line = next ? next.line : segments.length === 0 ? 1 : countLines(text)
  return {
    start_offset_utf16: offset,
    end_offset_utf16: offset,
    start_line: line,
    end_line: line,
    normalized_progress: clampProgress(offset / Math.max(1, text.length)),
  }
}

function textForRange(text: string, position: DocumentDiffPosition) {
  return text.slice(position.start_offset_utf16, position.end_offset_utf16)
}

/**
 * Deterministic line/paragraph hunk diff. Whitespace-only layout changes are
 * ignored, replacements stay as one modified hunk, and moved blocks remain a
 * truthful deletion plus addition at their respective source positions.
 */
export function buildDocumentDiff(baselineText: string, compareText: string): DocumentDiffHunk[] {
  const baselineSegments = segmentDocument(baselineText)
  const compareSegments = segmentDocument(compareText)
  const matches = collectLcsMatches(
    baselineSegments,
    0,
    baselineSegments.length,
    compareSegments,
    0,
    compareSegments.length
  )

  const hunks: DocumentDiffHunk[] = []
  let baselineCursor = 0
  let compareCursor = 0

  const boundaries: LcsMatch[] = [
    ...matches,
    { baseline: baselineSegments.length, compare: compareSegments.length },
  ]

  for (let matchIndex = 0; matchIndex < boundaries.length; matchIndex += 1) {
    const boundary = boundaries[matchIndex]
    if (boundary.baseline > baselineCursor || boundary.compare > compareCursor) {
      const baselinePosition = positionForRange(
        baselineText,
        baselineSegments,
        baselineCursor,
        boundary.baseline
      )
      const comparePosition = positionForRange(
        compareText,
        compareSegments,
        compareCursor,
        boundary.compare
      )
      const hasBaseline = boundary.baseline > baselineCursor
      const hasCompare = boundary.compare > compareCursor
      const sortOrder = hunks.length + 1
      hunks.push({
        id: `hunk-${sortOrder}-${baselinePosition.start_offset_utf16}-${comparePosition.start_offset_utf16}`,
        diff_type: hasBaseline && hasCompare ? 'modified' : hasBaseline ? 'deleted' : 'added',
        baseline_text: textForRange(baselineText, baselinePosition),
        compare_text: textForRange(compareText, comparePosition),
        baseline_position: baselinePosition,
        compare_position: comparePosition,
        sort_order: sortOrder,
      })
    }

    if (matchIndex < matches.length) {
      baselineCursor = boundary.baseline + 1
      compareCursor = boundary.compare + 1
    }
  }

  return hunks
}
