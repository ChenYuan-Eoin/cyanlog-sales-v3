'use client'

import { Input } from '@/components/ui/input'
import type { Config } from '../types'

interface TaxEditFormProps {
  config: Partial<Config>
  onChange: (config: Partial<Config>) => void
}

export default function TaxEditForm({ config, onChange }: TaxEditFormProps) {
  const value = config.value as { rate?: number; category?: string; enabled?: boolean; region?: string } || {}

  const updateValue = (patch: Partial<typeof value>) => {
    onChange({ ...config, value: { ...value, ...patch } })
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">配置键 (Key)</label>
        <Input
          value={config.key || ''}
          onChange={(e) => onChange({ ...config, key: e.target.value })}
          placeholder="如: TAX_STANDARD"
          disabled={!!config.id}
        />
        <p className="text-xs text-slate-500 mt-1">大写字母+下划线，如 TAX_SERVICE</p>
      </div>
      <div>
        <label className="text-sm font-medium">显示名称</label>
        <Input
          value={config.name || ''}
          onChange={(e) => onChange({ ...config, name: e.target.value })}
          placeholder="如: 标准增值税"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">税率 (%)</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={(value.rate || 0) * 100}
            onChange={(e) => updateValue({ rate: parseFloat(e.target.value) / 100 })}
          />
        </div>
        <div>
          <label className="text-sm font-medium">适用类别</label>
          <Input
            value={value.category || ''}
            onChange={(e) => updateValue({ category: e.target.value })}
            placeholder="如: 货物销售"
          />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">地区</label>
        <Input
          value={value.region || ''}
          onChange={(e) => updateValue({ region: e.target.value })}
          placeholder="如: 中国大陆"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.enabled || false}
          onChange={(e) => updateValue({ enabled: e.target.checked })}
        />
        <span className="text-sm">启用此税率</span>
      </div>
    </div>
  )
}
