'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import ConfigStatusBadge from './ConfigStatusBadge'
import type { Config } from '../types'

interface TaxTabProps {
  configs: Config[]
  onNew: () => void
  onEdit: (config: Config) => void
  onPublish: (id: string) => void
  onVersions: (id: string) => void
  onDelete: (id: string) => void
}

export default function TaxTab({ configs, onNew, onEdit, onPublish, onVersions, onDelete }: TaxTabProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>税率规则配置</CardTitle>
        <Button onClick={onNew}>+ 新增税率</Button>
      </CardHeader>
      <CardContent>
        {configs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-500">暂无税率规则</p>
            <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条税率配置</p>
          </div>
        ) : (
          <div className="rounded-md border divide-y">
            {configs.map((config) => (
              <div key={config.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{config.name}</span>
                    <ConfigStatusBadge status={config.status} />
                    {config.value?.enabled === true && (
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700">启用</Badge>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {config.key} · {(config.value?.category as string) || '通用'}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-mono font-semibold text-slate-700">
                    {((config.value?.rate as number) * 100).toFixed(0)}%
                  </span>
                  <Button variant="outline" size="sm" onClick={() => onEdit(config)}>编辑</Button>
                  {config.status !== 'PUBLISHED' && (
                    <Button variant="outline" size="sm" onClick={() => onPublish(config.id)}>发布</Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => onVersions(config.id)}>版本</Button>
                  <Button variant="outline" size="sm" className="text-red-600" onClick={() => onDelete(config.id)}>删除</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
