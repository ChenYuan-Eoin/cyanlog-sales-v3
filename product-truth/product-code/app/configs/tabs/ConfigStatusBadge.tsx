'use client'

import { Badge } from '@/components/ui/badge'

const CONFIG_STATUS_META: Record<string, { label: string; className: string }> = {
  DRAFT: { label: '草稿', className: 'bg-slate-100 text-slate-600' },
  PUBLISHED: { label: '已发布', className: 'bg-emerald-100 text-emerald-700' },
  ARCHIVED: { label: '已归档', className: 'bg-gray-100 text-gray-500' },
}

interface ConfigStatusBadgeProps {
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
}

export default function ConfigStatusBadge({ status }: ConfigStatusBadgeProps) {
  const meta = CONFIG_STATUS_META[status]
  return <Badge className={meta?.className}>{meta?.label}</Badge>
}
