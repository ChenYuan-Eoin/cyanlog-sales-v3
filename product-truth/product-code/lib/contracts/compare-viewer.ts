export const COMPARE_VIEWER_MIN_ZOOM = 60
export const COMPARE_VIEWER_MAX_ZOOM = 180
export const COMPARE_VIEWER_ZOOM_STEP = 10

export function clampCompareViewerZoom(value: number) {
  if (!Number.isFinite(value)) return 100
  return Math.min(COMPARE_VIEWER_MAX_ZOOM, Math.max(COMPARE_VIEWER_MIN_ZOOM, Math.round(value)))
}

export function nextCompareViewerZoom(current: number, direction: 'in' | 'out') {
  const delta = direction === 'in' ? COMPARE_VIEWER_ZOOM_STEP : -COMPARE_VIEWER_ZOOM_STEP
  return clampCompareViewerZoom(current + delta)
}

export function normalizedScrollProgress({
  scrollTop,
  scrollHeight,
  clientHeight,
}: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}) {
  const range = Math.max(0, scrollHeight - clientHeight)
  if (range === 0) return 0
  return Math.min(1, Math.max(0, scrollTop / range))
}

export function proportionalScrollTop(
  source: { scrollTop: number; scrollHeight: number; clientHeight: number },
  target: { scrollHeight: number; clientHeight: number }
) {
  const progress = normalizedScrollProgress(source)
  return progress * Math.max(0, target.scrollHeight - target.clientHeight)
}

export function fitWidthScale(viewportWidth: number, naturalPageWidth: number, gutter = 24) {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(naturalPageWidth) || naturalPageWidth <= 0) {
    return 1
  }
  const availableWidth = Math.max(1, viewportWidth - gutter)
  return Math.min(1.8, Math.max(0.4, availableWidth / naturalPageWidth))
}
