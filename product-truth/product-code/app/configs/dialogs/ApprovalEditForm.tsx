'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Config } from '../types'

interface ApprovalValue {
  rule_type?: 'discount' | 'contract'
  thresholds?: Array<{ limit: number; approver_role: string; enabled: boolean }>
}

interface ApprovalEditFormProps {
  config: Partial<Config>
  onChange: (config: Partial<Config>) => void
}

export default function ApprovalEditForm({ config, onChange }: ApprovalEditFormProps) {
  const value = (config.value as ApprovalValue) || {}
  const thresholds = value.thresholds || []

  const updateValue = (patch: Partial<ApprovalValue>) => {
    onChange({ ...config, value: { ...value, ...patch } })
  }

  const updateThreshold = (idx: number, field: 'limit' | 'approver_role' | 'enabled', val: unknown) => {
    const newThresholds = [...thresholds]
    newThresholds[idx] = { ...newThresholds[idx], [field]: val }
    updateValue({ thresholds: newThresholds })
  }

  const removeThreshold = (idx: number) => {
    updateValue({ thresholds: thresholds.filter((_, i) => i !== idx) })
  }

  const addThreshold = () => {
    updateValue({ thresholds: [...thresholds, { limit: 10, approver_role: 'auto', enabled: true }] })
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">配置键 (Key)</label>
        <Input
          value={config.key || ''}
          onChange={(e) => onChange({ ...config, key: e.target.value })}
          placeholder="如: APPROVAL_DISCOUNT"
          disabled={!!config.id}
        />
      </div>
      <div>
        <label className="text-sm font-medium">显示名称</label>
        <Input
          value={config.name || ''}
          onChange={(e) => onChange({ ...config, name: e.target.value })}
        />
      </div>
      <div>
        <label className="text-sm font-medium">规则类型</label>
        <select
          className="w-full mt-1 p-2 border rounded-md"
          value={value.rule_type || 'discount'}
          onChange={(e) => updateValue({ rule_type: e.target.value as 'discount' | 'contract' })}
        >
          <option value="discount">折扣审批</option>
          <option value="contract">合同审批</option>
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">审批阈值</label>
          <Button type="button" variant="outline" size="sm" onClick={addThreshold}>
            + 添加阈值
          </Button>
        </div>
        <div className="space-y-2">
          {thresholds.map((t, idx) => (
            <div key={idx} className="flex items-center gap-2 p-2 bg-slate-50 rounded">
              <Input
                type="number"
                className="w-20"
                value={t.limit}
                onChange={(e) => updateThreshold(idx, 'limit', parseFloat(e.target.value))}
                placeholder={value.rule_type === 'discount' ? '折扣%' : '金额'}
              />
              <Input
                className="flex-1"
                value={t.approver_role}
                onChange={(e) => updateThreshold(idx, 'approver_role', e.target.value)}
                placeholder="审批角色，如 sales_manager"
              />
              <input
                type="checkbox"
                checked={t.enabled}
                onChange={(e) => updateThreshold(idx, 'enabled', e.target.checked)}
                title="启用"
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => removeThreshold(idx)}>
                ×
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
