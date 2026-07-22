export interface SourceIdentity {
  contractId: string
  storagePath: string
  sourceHash: string
  page: number
}

export interface NormalizedPoint {
  x: number
  y: number
}

export interface NormalizedRegion extends NormalizedPoint {
  width: number
  height: number
}

export type SourceAnnotationAnchor =
  | { kind: 'text'; start: number; end: number; exact: string; region?: NormalizedRegion; ocrConfidence?: number }
  | { kind: 'region'; region: NormalizedRegion; ocrText?: string; ocrConfidence?: number }
  | { kind: 'point'; point: NormalizedPoint; ocrText?: string; ocrConfidence?: number }

export interface SourceAnnotation {
  id: string
  source: SourceIdentity
  anchor: SourceAnnotationAnchor
  comment: string
}

function isUnit(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function validPoint(point: NormalizedPoint) {
  return isUnit(point.x) && isUnit(point.y)
}

function validRegion(region: NormalizedRegion) {
  return validPoint(region)
    && region.width > 0
    && region.height > 0
    && region.x + region.width <= 1
    && region.y + region.height <= 1
}

export function validateSourceAnnotation(annotation: SourceAnnotation): string[] {
  const errors: string[] = []
  if (!annotation.id.trim()) errors.push('annotation.id 不能为空')
  if (!annotation.comment.trim()) errors.push('comment 不能为空')
  if (!annotation.source.contractId.trim()) errors.push('source.contractId 不能为空')
  if (!annotation.source.storagePath.trim()) errors.push('source.storagePath 不能为空')
  if (!/^[a-f0-9]{64}$/i.test(annotation.source.sourceHash)) errors.push('source.sourceHash 必须是 SHA-256')
  if (!Number.isInteger(annotation.source.page) || annotation.source.page < 1) errors.push('source.page 必须是正整数')

  const { anchor } = annotation
  if (anchor.kind === 'text') {
    if (!Number.isInteger(anchor.start) || anchor.start < 0) errors.push('text.start 必须是非负整数')
    if (!Number.isInteger(anchor.end) || anchor.end <= anchor.start) errors.push('text.end 必须大于 start')
    if (!anchor.exact) errors.push('text.exact 不能为空')
    if (anchor.region && !validRegion(anchor.region)) errors.push('text.region 必须位于归一化页面范围内')
  } else if (anchor.kind === 'region') {
    if (!validRegion(anchor.region)) errors.push('region 必须位于归一化页面范围内')
  } else if (!validPoint(anchor.point)) {
    errors.push('point 必须位于归一化页面范围内')
  }

  if ('ocrConfidence' in anchor && anchor.ocrConfidence !== undefined && !isUnit(anchor.ocrConfidence)) {
    errors.push('ocrConfidence 必须介于 0 和 1')
  }
  return errors
}
