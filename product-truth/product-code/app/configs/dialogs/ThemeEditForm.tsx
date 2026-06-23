'use client'

import { Input } from '@/components/ui/input'
import { ImageUpload } from '@/components/ui/ImageUpload'
import { DEFAULT_THEME } from '@/lib/ui-theme-shared'
import type { Config } from '../types'

interface ThemeEditFormProps {
  config: Partial<Config>
  onChange: (config: Partial<Config>) => void
}

export default function ThemeEditForm({ config, onChange }: ThemeEditFormProps) {
  const value = (config.value as Record<string, unknown>) || { ...DEFAULT_THEME }

  const updateValue = (patch: Record<string, unknown>) => {
    onChange({ ...config, value: { ...value, ...patch } })
  }

  const setThemeField = (field: string, nextValue: unknown) => {
    updateValue({ [field]: nextValue })
  }

  const colorFields = [
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

  const getBrandAssets = () => {
    return (value.brandAssets as { fullLogo?: { light?: string; dark?: string }; symbol?: { light?: string; dark?: string }; favicon?: string }) || { fullLogo: {}, symbol: {}, favicon: '' }
  }

  const updateBrandAsset = (path: string[], url: string) => {
    const current = getBrandAssets()
    if (path.length === 2) {
      const [section, variant] = path
      const sectionData = (current[section as keyof typeof current] as Record<string, string>) || {}
      updateValue({
        brandAssets: { ...current, [section]: { ...sectionData, [variant]: url } }
      })
    } else if (path.length === 1) {
      updateValue({ brandAssets: { ...current, [path[0]]: url } })
    }
  }

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
        <div>
          <label className="text-sm font-medium">品牌名称</label>
          <Input
            value={String(value.brandName || '')}
            onChange={(e) => setThemeField('brandName', e.target.value)}
            placeholder="如: Cyanlog"
          />
        </div>
        <div>
          <label className="text-sm font-medium">品牌简称</label>
          <Input
            value={String(value.brandShortName || '')}
            onChange={(e) => setThemeField('brandShortName', e.target.value)}
            placeholder="如: CY"
          />
        </div>
        <div>
          <label className="text-sm font-medium">浏览器标题</label>
          <Input
            value={String(value.productTitle || '')}
            onChange={(e) => setThemeField('productTitle', e.target.value)}
            placeholder="如: Cyanlog Sales"
          />
        </div>
        <div>
          <label className="text-sm font-medium">侧栏副标题</label>
          <Input
            value={String(value.productSubtitle || '')}
            onChange={(e) => setThemeField('productSubtitle', e.target.value)}
            placeholder="如: 智能销售支撑平台"
          />
        </div>
        <div>
          <label className="text-sm font-medium">登录页标题</label>
          <Input
            value={String(value.loginTitle || '')}
            onChange={(e) => setThemeField('loginTitle', e.target.value)}
            placeholder="如: 企业销售支撑平台"
          />
        </div>
        <div>
          <label className="text-sm font-medium">登录页副标题</label>
          <Input
            value={String(value.loginSubtitle || '')}
            onChange={(e) => setThemeField('loginSubtitle', e.target.value)}
            placeholder="如: 使用企业账号进入工作台首页"
          />
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
          <p className="text-xs text-slate-500 mt-1">决定 Logo 调用亮色版还是暗色版</p>
        </div>

        <div className="col-span-2 border-t pt-6 mt-4">
          <h4 className="text-base font-semibold mb-4">品牌资产配置</h4>

          <div className="mb-6">
            <p className="text-sm font-medium text-slate-700 mb-3">完整 Logo</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-white border rounded-lg">
                <label className="text-sm font-medium">亮色版</label>
                <p className="text-xs text-slate-500 mb-3">用于浅色背景</p>
                <ImageUpload
                  value={String(getBrandAssets().fullLogo?.light || '')}
                  onChange={(url) => updateBrandAsset(['fullLogo', 'light'], url)}
                  folder="logos"
                  showUrlInput={false}
                />
              </div>
              <div className="p-4 bg-slate-800 border border-slate-700 rounded-lg">
                <label className="text-sm font-medium text-white">暗色版</label>
                <p className="text-xs text-slate-400 mb-3">用于深色背景</p>
                <ImageUpload
                  value={String(getBrandAssets().fullLogo?.dark || '')}
                  onChange={(url) => updateBrandAsset(['fullLogo', 'dark'], url)}
                  folder="logos"
                  showUrlInput={false}
                />
              </div>
            </div>
          </div>

          <div className="mb-6">
            <p className="text-sm font-medium text-slate-700 mb-3">图标符号（侧边栏折叠、移动端）</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-white border rounded-lg">
                <label className="text-sm font-medium">亮色版</label>
                <p className="text-xs text-slate-500 mb-3">浅色背景使用</p>
                <ImageUpload
                  value={String(getBrandAssets().symbol?.light || '')}
                  onChange={(url) => updateBrandAsset(['symbol', 'light'], url)}
                  folder="logos"
                  showUrlInput={false}
                />
              </div>
              <div className="p-4 bg-slate-800 border border-slate-700 rounded-lg">
                <label className="text-sm font-medium text-white">暗色版</label>
                <p className="text-xs text-slate-400 mb-3">深色背景使用</p>
                <ImageUpload
                  value={String(getBrandAssets().symbol?.dark || '')}
                  onChange={(url) => updateBrandAsset(['symbol', 'dark'], url)}
                  folder="logos"
                  showUrlInput={false}
                />
              </div>
            </div>
          </div>

          <div className="mb-4">
            <p className="text-sm font-medium text-slate-700 mb-3">浏览器 Favicon</p>
            <div className="p-4 bg-white border rounded-lg max-w-sm">
              <label className="text-sm font-medium">Favicon 图标</label>
              <p className="text-xs text-slate-500 mb-3">1:1 正方形，建议 32×32 或 64×64 像素</p>
              <ImageUpload
                value={String(getBrandAssets().favicon || '')}
                onChange={(url) => updateBrandAsset(['favicon'], url)}
                folder="favicons"
                accept="image/png,image/x-icon,image/svg+xml"
                square={true}
                previewHeight={48}
                showUrlInput={false}
              />
            </div>
          </div>
        </div>

        <div className="hidden">
          <Input value={String(value.logoUrl || '')} onChange={(e) => setThemeField('logoUrl', e.target.value)} />
          <Input value={String(value.faviconUrl || '')} onChange={(e) => setThemeField('faviconUrl', e.target.value)} />
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
