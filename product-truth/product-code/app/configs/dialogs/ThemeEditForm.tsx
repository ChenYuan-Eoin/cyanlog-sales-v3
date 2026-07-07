'use client'

import { Input } from '@/components/ui/input'
import { sanitizeThemeValue } from '@/lib/ui-theme-shared'
import type { Config } from '../types'

type ThemeValue = ReturnType<typeof sanitizeThemeValue>
type ThemeField = keyof ThemeValue
type ColorThemeField =
  | 'primary'
  | 'primaryForeground'
  | 'secondary'
  | 'secondaryForeground'
  | 'background'
  | 'foreground'
  | 'border'
  | 'input'
  | 'ring'
  | 'destructive'

interface ThemeEditFormProps {
  config: Partial<Config>
  onChange: (config: Partial<Config>) => void
}

export default function ThemeEditForm({ config, onChange }: ThemeEditFormProps) {
  const value = sanitizeThemeValue(config.value as Record<string, unknown> | undefined)

  const updateValue = (patch: Record<string, unknown>) => {
    onChange({ ...config, value: { ...value, ...patch } })
  }

  const setThemeField = (field: ThemeField, nextValue: unknown) => {
    updateValue({ [field]: nextValue })
  }

  const colorFields: Array<{ key: ColorThemeField; label: string }> = [
    { key: 'primary', label: '主按钮背景' },
    { key: 'primaryForeground', label: '主按钮文字' },
    { key: 'secondary', label: '次按钮背景' },
    { key: 'secondaryForeground', label: '次按钮文字' },
    { key: 'background', label: '页面背景' },
    { key: 'foreground', label: '基础文字' },
    { key: 'border', label: '边框' },
    { key: 'input', label: '输入框背景' },
    { key: 'ring', label: '焦点高亮' },
    { key: 'destructive', label: '危险态' },
  ]

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">配置键 (Key)</label>
        <Input
          value={config.key || ''}
          onChange={(e) => onChange({ ...config, key: e.target.value })}
          placeholder="如: UI_THEME_DEFAULT"
          disabled={!!config.id}
        />
      </div>
      <div>
        <label className="text-sm font-medium">显示名称</label>
        <Input
          value={config.name || ''}
          onChange={(e) => onChange({ ...config, name: e.target.value })}
          placeholder="如: 蓝色主题"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
          品牌名称、侧栏 Logo、浏览器标题和 Favicon 不属于 UI 主题。主题只管理颜色、圆角和外观密度；品牌资产应由独立 BrandProfile 发布后统一生效。
        </div>
        <div>
          <label className="text-sm font-medium">主题外观</label>
          <select
            className="w-full mt-1 p-2 border rounded-md"
            value={String(value.appearance || 'system')}
            onChange={(e) => setThemeField('appearance', e.target.value)}
          >
            <option value="system">跟随系统</option>
            <option value="light">强制亮色</option>
            <option value="dark">强制暗色</option>
          </select>
          <p className="text-xs text-slate-500 mt-1">只影响明暗色和视觉变量，不选择 Logo 版本。</p>
        </div>

      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {colorFields.map((field) => (
          <div key={field.key}>
            <label className="text-sm font-medium">{field.label}</label>
            <div className="mt-1 flex gap-2">
              <Input
                type="color"
                className="w-14 p-1"
                value={String(value[field.key] || '#000000')}
                onChange={(e) => setThemeField(field.key, e.target.value)}
              />
              <Input
                value={String(value[field.key] || '')}
                onChange={(e) => setThemeField(field.key, e.target.value)}
                placeholder="#2563eb"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">按钮圆角</label>
          <Input
            type="number"
            min={0}
            max={32}
            value={Number(value.radiusMd ?? 10)}
            onChange={(e) => setThemeField('radiusMd', Number(e.target.value))}
          />
        </div>
        <div>
          <label className="text-sm font-medium">卡片圆角</label>
          <Input
            type="number"
            min={0}
            max={32}
            value={Number(value.radiusLg ?? 16)}
            onChange={(e) => setThemeField('radiusLg', Number(e.target.value))}
          />
        </div>
      </div>
    </div>
  )
}
