'use client'

import { Input } from '@/components/ui/input'
import type { Config } from '../types'

interface AIValue {
  level?: number
  name?: string
  profile?: string
  provider_kind?: string
  base_url?: string
  api_key?: string
  model?: string
  timeout_ms?: number
  enabled?: boolean
  routing?: { max_pages?: number; strategy?: string }
}

interface AIEditFormProps {
  config: Partial<Config>
  onChange: (config: Partial<Config>) => void
}

export default function AIEditForm({ config, onChange }: AIEditFormProps) {
  const value = (config.value as AIValue) || {}

  const updateValue = (patch: Partial<AIValue>) => {
    onChange({ ...config, value: { ...value, ...patch } })
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">配置键 (Key)</label>
        <Input
          value={config.key || ''}
          onChange={(e) => onChange({ ...config, key: e.target.value })}
          placeholder="如: AI_LEVEL_1"
          disabled={!!config.id}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">降级等级</label>
          <Input
            type="number"
            min={1}
            max={3}
            value={value.level || 1}
            onChange={(e) => updateValue({ level: parseInt(e.target.value) })}
          />
        </div>
        <div>
          <label className="text-sm font-medium">显示名称</label>
          <Input
            value={config.name || ''}
            onChange={(e) => onChange({ ...config, name: e.target.value, value: { ...value, name: e.target.value } })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">运行画像</label>
          <select
            className="w-full mt-1 p-2 border rounded-md"
            value={value.profile || 'local_primary'}
            onChange={(e) => updateValue({ profile: e.target.value })}
          >
            <option value="local_primary">local_primary</option>
            <option value="cloud_primary">cloud_primary</option>
            <option value="sales_cloud_backup">sales_cloud_backup</option>
            <option value="rule_engine">rule_engine</option>
            <option value="custom">custom</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">Provider 类型</label>
          <select
            className="w-full mt-1 p-2 border rounded-md"
            value={value.provider_kind || 'openai_compatible'}
            onChange={(e) => updateValue({ provider_kind: e.target.value })}
          >
            <option value="openai_compatible">openai_compatible</option>
            <option value="builtin">builtin</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">模型标识</label>
        <Input
          value={value.model || ''}
          onChange={(e) => updateValue({ model: e.target.value })}
          placeholder="如: claude-sonnet, local-model"
        />
      </div>
      <div>
        <label className="text-sm font-medium">API 地址</label>
        <Input
          value={value.base_url || ''}
          onChange={(e) => updateValue({ base_url: e.target.value })}
          placeholder={value.provider_kind === 'builtin' ? 'builtin 可留空' : '如: http://localhost:1234/v1'}
        />
      </div>
      <div>
        <label className="text-sm font-medium">API Key (可选)</label>
        <Input
          type="password"
          value={value.api_key || ''}
          onChange={(e) => updateValue({ api_key: e.target.value })}
          placeholder="留空保持现有值"
        />
        <p className="text-xs text-slate-500 mt-1">安全存储，API 返回时脱敏显示</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">超时 (毫秒)</label>
          <Input
            type="number"
            step={1000}
            value={value.timeout_ms || 45000}
            onChange={(e) => updateValue({ timeout_ms: parseInt(e.target.value) })}
          />
        </div>
        <div>
          <label className="text-sm font-medium">最大页数</label>
          <Input
            type="number"
            value={value.routing?.max_pages || 15}
            onChange={(e) => updateValue({ routing: { ...value.routing, max_pages: parseInt(e.target.value) } })}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.enabled || false}
          onChange={(e) => updateValue({ enabled: e.target.checked })}
        />
        <span className="text-sm">启用此模型配置</span>
      </div>
    </div>
  )
}
