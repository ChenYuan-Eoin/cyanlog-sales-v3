// 商务资质库数据源 - F017

export type QualType = 'ENTERPRISE' | 'PERSONNEL' | 'PERFORMANCE' | 'PARTNER'

export interface BusinessQualification {
  id: string
  title: string
  qual_type: QualType
  cert_no?: string | null
  issuer?: string | null
  issued_at?: string | null
  expires_at?: string | null
  file_url?: string | null
  notes?: string | null
  created_by?: string | null
  created_at: string
  updated_at: string
}

export const QUAL_TYPES: QualType[] = ['ENTERPRISE', 'PERSONNEL', 'PERFORMANCE', 'PARTNER']

export const QUAL_TYPE_LABEL: Record<QualType, string> = {
  ENTERPRISE: '企业资质',
  PERSONNEL: '人员资质',
  PERFORMANCE: '业绩证明',
  PARTNER: '合作伙伴',
}

export const QUAL_TYPE_COLOR: Record<QualType, string> = {
  ENTERPRISE: 'bg-blue-100 text-blue-700',
  PERSONNEL: 'bg-purple-100 text-purple-700',
  PERFORMANCE: 'bg-emerald-100 text-emerald-700',
  PARTNER: 'bg-orange-100 text-orange-700',
}

// 检查是否即将到期（30 天内）
export function isExpiringSoon(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false
  const expiry = new Date(expiresAt)
  const now = new Date()
  const days = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  return days >= 0 && days <= 30
}

export function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt) < new Date()
}
