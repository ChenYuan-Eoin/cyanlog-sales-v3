'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import ConfigStatusBadge from './ConfigStatusBadge'
import type { Config } from '../types'

interface AIConfigTabProps {
  configs: Config[]
  onNew: () => void
  onEdit: (config: Config) => void
  onPublish: (id: string) => void
  onDelete: (id: string) => void
}

export default function AIConfigTab({ configs, onNew, onEdit, onPublish, onDelete }: AIConfigTabProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>AI 模型配置（3级降级链）</CardTitle>
        <Button onClick={onNew}>+ 新增模型</Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {configs.map((config) => (
            <div key={config.id} className="rounded-lg border p-4">
              <div className="flex items-baseline justify-between mb-3">
                <div className="text-sm font-semibold text-slate-900">
                  Level {(config.value?.level as number)} · {config.name}
                </div>
                <div className="flex gap-1">
                  <ConfigStatusBadge status={config.status} />
                  {config.value?.enabled === true && <Badge className="bg-emerald-100 text-emerald-700">启用</Badge>}
                </div>
              </div>

              <div className="text-xs text-slate-600 space-y-1.5 mb-4">
                <div className="truncate">画像: {(config.value?.profile as string) || '未设置'}</div>
                <div className="truncate">类型: {(config.value?.provider_kind as string) || 'openai_compatible'}</div>
                <div className="truncate">模型: {config.value?.model as string}</div>
                <div className="truncate">地址: {(config.value?.base_url as string) || '（内置）'}</div>
                <div>超时: {(config.value?.timeout_ms as number) / 1000}s</div>
                {typeof config.value?.api_key === 'string' && config.value.api_key.length > 0 && <div className="font-mono text-slate-400">{config.value.api_key}</div>}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(config)}>编辑</Button>
                {config.status !== 'PUBLISHED' && (
                  <Button variant="outline" size="sm" onClick={() => onPublish(config.id)}>发布</Button>
                )}
                <Button variant="outline" size="sm" onClick={() => onDelete(config.id)}>删除</Button>
              </div>
            </div>
          ))}
        </div>

        {configs.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-500">暂无 AI 模型配置</p>
            <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条 AI 配置</p>
          </div>
        )}

        <div className="rounded-md border mt-4">
          <div className="px-4 py-2 bg-slate-50 border-b text-xs font-medium text-slate-700">路由策略（按文档页数）</div>
          <div className="divide-y">
            {[
              { pages: '≤ 15 页', level: 1, strategy: '整体送入本地' },
              { pages: '15 - 40 页', level: 1, strategy: '分段送入本地' },
              { pages: '> 40 页', level: 2, strategy: '强制云端' },
            ].map((row, idx) => (
              <div key={idx} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="font-mono text-slate-700">{row.pages}</span>
                <span className="text-xs text-slate-500">{row.strategy}</span>
                <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded">Level {row.level}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
