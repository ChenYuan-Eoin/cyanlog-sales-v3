'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import ConfigStatusBadge from './ConfigStatusBadge'
import type { Config } from '../types'

interface ThemeTabProps {
  configs: Config[]
  onNew: () => void
  onEdit: (config: Config) => void
  onPublish: (id: string) => void
  onVersions: (id: string) => void
  onDelete: (id: string) => void
}

export default function ThemeTab({ configs, onNew, onEdit, onPublish, onVersions, onDelete }: ThemeTabProps) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>运行时主题</CardTitle>
        <Button onClick={onNew} className="w-full sm:w-auto">+ 新增主题</Button>
      </CardHeader>
      <CardContent>
        {configs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-500">暂无主题配置</p>
            <p className="text-sm text-slate-400 mt-2">发布后，按钮和输入框会在运行时自动应用。</p>
          </div>
        ) : (
          <div className="space-y-4">
            {configs.map((config) => (
              <div key={config.id} className="rounded-lg border p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{config.name}</span>
                      <ConfigStatusBadge status={config.status} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: 'Primary', value: String(config.value?.primary || '') },
                        { label: 'Secondary', value: String(config.value?.secondary || '') },
                        { label: 'Border', value: String(config.value?.border || '') },
                        { label: 'Background', value: String(config.value?.background || '') },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                          <span
                            className="size-3 rounded-sm border"
                            style={{ backgroundColor: item.value }}
                          />
                          <span className="font-mono">{item.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>radius-md: {String(config.value?.radiusMd ?? '')}px</span>
                      <span>radius-lg: {String(config.value?.radiusLg ?? '')}px</span>
                    </div>
                  </div>
                  <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:justify-end">
                    <Button variant="outline" size="sm" className="flex-1 lg:flex-none" onClick={() => onEdit(config)}>编辑</Button>
                    {config.status !== 'PUBLISHED' && (
                      <Button variant="outline" size="sm" className="flex-1 lg:flex-none" onClick={() => onPublish(config.id)}>发布</Button>
                    )}
                    <Button variant="outline" size="sm" className="flex-1 lg:flex-none" onClick={() => onVersions(config.id)}>版本</Button>
                    <Button variant="outline" size="sm" className="flex-1 text-red-600 lg:flex-none" onClick={() => onDelete(config.id)}>删除</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
