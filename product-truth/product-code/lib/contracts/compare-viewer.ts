export const COMPARE_VIEWER_MIN_ZOOM = 60
export const COMPARE_VIEWER_MAX_ZOOM = 180
export const COMPARE_VIEWER_ZOOM_STEP = 10

export type CompareViewerScrollMode = 'independent' | 'synchronized'

export interface ScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

export function clampCompareViewerZoom(value: number) {
  const safeValue = finiteOr(value, 100)
  return Math.min(
    COMPARE_VIEWER_MAX_ZOOM,
    Math.max(COMPARE_VIEWER_MIN_ZOOM, Math.round(safeValue))
  )
}

export function nextCompareViewerZoom(current: number, direction: 'in' | 'out') {
  const delta = direction === 'in' ? COMPARE_VIEWER_ZOOM_STEP : -COMPARE_VIEWER_ZOOM_STEP
  return clampCompareViewerZoom(current + delta)
}

export function normalizedScrollProgress({ scrollTop, scrollHeight, clientHeight }: ScrollMetrics) {
  const range = Math.max(0, finiteOr(scrollHeight, 0) - Math.max(0, finiteOr(clientHeight, 0)))
  if (range === 0) return 0
  return Math.min(1, Math.max(0, finiteOr(scrollTop, 0) / range))
}

export function scrollTopForProgress(
  progress: number,
  target: Pick<ScrollMetrics, 'scrollHeight' | 'clientHeight'>
) {
  const normalized = Math.min(1, Math.max(0, finiteOr(progress, 0)))
  const range = Math.max(
    0,
    finiteOr(target.scrollHeight, 0) - Math.max(0, finiteOr(target.clientHeight, 0))
  )
  return normalized * range
}

export function proportionalScrollTop(
  source: ScrollMetrics,
  target: Pick<ScrollMetrics, 'scrollHeight' | 'clientHeight'>
) {
  return scrollTopForProgress(normalizedScrollProgress(source), target)
}

/** Null means independent mode must leave the other pane untouched. */
export function synchronizedTargetScrollTop(
  mode: CompareViewerScrollMode,
  source: ScrollMetrics,
  target: Pick<ScrollMetrics, 'scrollHeight' | 'clientHeight'>
) {
  return mode === 'synchronized' ? proportionalScrollTop(source, target) : null
}

export function fitWidthScale(viewportWidth: number, naturalPageWidth: number, gutter = 24) {
  const safeViewport = finiteOr(viewportWidth, 0)
  const safePageWidth = finiteOr(naturalPageWidth, 0)
  const safeGutter = Math.max(0, finiteOr(gutter, 24))
  if (safeViewport <= 0 || safePageWidth <= 0) return 1
  const rawScale = Math.max(1, safeViewport - safeGutter) / safePageWidth
  return clampCompareViewerZoom(rawScale * 100) / 100
}
