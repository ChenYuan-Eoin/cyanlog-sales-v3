'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import ConfigStatusBadge from './ConfigStatusBadge'
import type { Config } from '../types'

interface ApprovalTabProps {
  configs: Config[]
  onNew: () => void
  onEdit: (config: Config) => void
  onPublish: (id: string) => void
  onVersions: (id: string) => void
  onDelete: (id: string) => void
}

export default function ApprovalTab({ configs, onNew, onEdit, onPublish, onVersions, onDelete }: ApprovalTabProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>审批权限配置</CardTitle>
        <Button onClick={onNew}>+ 新增规则</Button>
      </CardHeader>
      <CardContent>
        {configs.map((config) => (
          <div key={config.id} className="mb-6 last:mb-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900">{config.name}</span>
                <ConfigStatusBadge status={config.status} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => onEdit(config)}>编辑</Button>
                {config.status !== 'PUBLISHED' && (
                  <Button variant="outline" size="sm" onClick={() => onPublish(config.id)}>发布</Button>
                )}
                <Button variant="outline" size="sm" onClick={() => onVersions(config.id)}>版本</Button>
                <Button variant="outline" size="sm" className="text-red-600" onClick={() => onDelete(config.id)}>删除</Button>
              </div>
            </div>

            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-slate-700">序号</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-700">阈值条件</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-700">审批角色</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-700">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {(config.value?.thresholds as Array<{ limit: number; approver_role: string; enabled: boolean }>)?.map((t, idx) => (
                    <tr key={idx} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-mono">{idx + 1}</td>
                      <td className="px-4 py-2">
                        {(config.value?.rule_type as string) === 'discount' ? `≤ ${t.limit}%` : `≤ ¥${t.limit.toLocaleString()}`}
                      </td>
                      <td className="px-4 py-2">{t.approver_role}</td>
                      <td className="px-4 py-2">
                        {t.enabled ? (
                          <Badge className="bg-emerald-100 text-emerald-700">启用</Badge>
                        ) : (
                          <Badge variant="secondary">禁用</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {config.description && <p className="text-xs text-slate-500 mt-2">{config.description}</p>}
          </div>
        ))}

        {configs.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-500">暂无审批权限配置</p>
            <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条审批配置</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
