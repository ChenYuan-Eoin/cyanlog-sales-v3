'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { resolveBrandImageUrl, resolveFaviconUrl, sanitizeThemeValue } from '@/lib/ui-theme-shared'
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
  const sortedConfigs = [...configs].sort((left, right) =>
    new Date(right.updated_at || 0).getTime() - new Date(left.updated_at || 0).getTime()
  )
  const publishedConfigs = sortedConfigs.filter((config) => config.status === 'PUBLISHED')
  const activeConfig = publishedConfigs[0] || null
  const activeTheme = activeConfig
    ? sanitizeThemeValue(activeConfig.value as Record<string, unknown> | undefined)
    : null
  const activeFavicon = activeTheme ? resolveFaviconUrl(activeTheme) : ''
  const activeLogo = activeTheme ? resolveBrandImageUrl(activeTheme, 'full', 'dark') || resolveBrandImageUrl(activeTheme, 'symbol', 'dark') : ''

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>品牌主题 Profile</CardTitle>
          <p className="mt-1 text-sm text-slate-500">同一组织只允许一个已发布主题作为当前 BrandProfile，favicon、Logo 和浏览器标题都从这里读取。</p>
        </div>
        <Button onClick={onNew} className="w-full sm:w-auto">+ 新增主题</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-500">当前生效 BrandProfile</div>
              <div className="mt-1 text-base font-semibold text-slate-900">
                {activeConfig ? activeConfig.name : '未发布主题'}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {activeTheme
                  ? `${activeTheme.brandName} · ${activeTheme.productTitle} · ${activeConfig?.key}`
                  : '发布一个主题后，运行时才会更新 favicon、侧栏 Logo 和浏览器标题。'}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-12 min-w-44 items-center gap-3 rounded-md border border-slate-200 bg-white px-3">
                {activeLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={activeLogo} alt="" className="max-h-7 max-w-28 object-contain" />
                ) : (
                  <div className="grid h-8 w-8 place-items-center rounded-md bg-slate-900 text-xs font-semibold text-white">
                    {activeTheme?.brandShortName || 'OS'}
                  </div>
                )}
                <span className="text-sm font-medium text-slate-700">{activeTheme?.brandName || 'ONES Sales'}</span>
              </div>
              <div className="flex h-12 items-center gap-2 rounded-md border border-slate-200 bg-white px-3">
                {activeFavicon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={activeFavicon} alt="" className="h-6 w-6 rounded-sm object-contain" />
                ) : (
                  <div className="h-6 w-6 rounded-sm bg-slate-200" />
                )}
                <span className="text-xs text-slate-500">浏览器图标</span>
              </div>
            </div>
          </div>
          {publishedConfigs.length > 1 ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              检测到 {publishedConfigs.length} 个已发布主题。系统会按最新更新时间选择当前生效项；再次发布任一主题后会自动归档其他主题。
            </div>
          ) : null}
          <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
            <ThemeRuntimeFact label="浏览器标题" value={activeTheme?.productTitle || '未发布'} ready={Boolean(activeTheme?.productTitle)} />
            <ThemeRuntimeFact label="侧栏 Logo" value={activeLogo ? '已绑定品牌资产' : '使用缩写兜底'} ready={Boolean(activeLogo)} />
            <ThemeRuntimeFact label="Favicon" value={activeFavicon || '未绑定 favicon'} ready={Boolean(activeFavicon)} />
          </div>
        </div>
        {configs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-500">暂无主题配置</p>
            <p className="text-sm text-slate-400 mt-2">发布后，按钮和输入框会在运行时自动应用。</p>
          </div>
        ) : (
          <div className="space-y-4">
            {sortedConfigs.map((config) => {
              const theme = sanitizeThemeValue(config.value as Record<string, unknown> | undefined)
              const isActive = activeConfig?.id === config.id
              const favicon = resolveFaviconUrl(theme)
              const logo = resolveBrandImageUrl(theme, 'full', 'dark') || resolveBrandImageUrl(theme, 'symbol', 'dark')

              return (
                <div key={config.id} className={`rounded-lg border p-4 ${isActive ? 'border-emerald-300 bg-emerald-50/40' : ''}`}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{config.name}</span>
                        <ConfigStatusBadge status={config.status} />
                        {isActive ? (
                          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">当前生效</span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
                        <span>品牌：{theme.brandName}</span>
                        <span>标题：{theme.productTitle}</span>
                        <span>副标题：{theme.productSubtitle}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        <span>Logo：{logo ? '已配置' : '未配置'}</span>
                        <span>Favicon：{favicon ? '已配置' : '未配置'}</span>
                        <span>更新：{new Date(config.updated_at).toLocaleString('zh-CN')}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { label: 'Primary', value: theme.primary },
                          { label: 'Secondary', value: theme.secondary },
                          { label: 'Border', value: theme.border },
                          { label: 'Background', value: theme.background },
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
                        <span>radius-md: {theme.radiusMd}px</span>
                        <span>radius-lg: {theme.radiusLg}px</span>
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
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ThemeRuntimeFact({
  label,
  value,
  ready,
}: {
  label: string
  value: string
  ready: boolean
}) {
  return (
    <div className={`rounded-md border px-3 py-2 ${
      ready ? 'border-emerald-200 bg-white text-slate-700' : 'border-amber-200 bg-amber-50 text-amber-800'
    }`}>
      <div className="font-medium">{label}</div>
      <div className="mt-1 truncate">{value}</div>
    </div>
  )
}
