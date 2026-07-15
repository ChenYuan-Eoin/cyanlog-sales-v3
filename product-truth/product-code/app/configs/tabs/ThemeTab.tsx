'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ImageUpload } from '@/components/ui/ImageUpload'
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
  onRefresh?: () => void | Promise<void>
}

interface BrandProfileDraft {
  brandName: string
  brandShortName: string
  productTitle: string
  productSubtitle: string
  loginTitle: string
  loginSubtitle: string
  fullLogoLight: string
  fullLogoDark: string
  symbolLight: string
  symbolDark: string
  favicon: string
}

export default function ThemeTab({ configs, onNew, onEdit, onPublish, onVersions, onDelete, onRefresh }: ThemeTabProps) {
  const sortedConfigs = [...configs].sort((left, right) =>
    new Date(right.updated_at || 0).getTime() - new Date(left.updated_at || 0).getTime()
  )
  const publishedConfigs = sortedConfigs.filter((config) => config.status === 'PUBLISHED')
  const activeConfig = publishedConfigs[0] || null
  const activeTheme = useMemo(() => (
    activeConfig
      ? sanitizeThemeValue(activeConfig.value as Record<string, unknown> | undefined)
      : null
  ), [activeConfig])
  const activeFavicon = activeTheme ? resolveFaviconUrl(activeTheme) : ''
  const activeLogo = activeTheme ? resolveBrandImageUrl(activeTheme, 'full', 'dark') || resolveBrandImageUrl(activeTheme, 'symbol', 'dark') : ''
  const initialBrandDraft = useMemo<BrandProfileDraft>(() => ({
    brandName: activeTheme?.brandName || 'ONES Sales',
    brandShortName: activeTheme?.brandShortName || 'OS',
    productTitle: activeTheme?.productTitle || 'ONES Sales',
    productSubtitle: activeTheme?.productSubtitle || '智能协作平台',
    loginTitle: activeTheme?.loginTitle || '企业协作支撑平台',
    loginSubtitle: activeTheme?.loginSubtitle || '使用企业账号进入工作台首页',
    fullLogoLight: activeTheme?.brandAssets.fullLogo.light || '',
    fullLogoDark: activeTheme?.brandAssets.fullLogo.dark || '',
    symbolLight: activeTheme?.brandAssets.symbol.light || '',
    symbolDark: activeTheme?.brandAssets.symbol.dark || '',
    favicon: activeTheme?.brandAssets.favicon || '',
  }), [activeTheme])
  const [brandDraft, setBrandDraft] = useState<BrandProfileDraft>(initialBrandDraft)
  const [isBrandEditing, setIsBrandEditing] = useState(false)
  const [isBrandSaving, setIsBrandSaving] = useState(false)
  const [brandError, setBrandError] = useState<string | null>(null)

  useEffect(() => {
    setBrandDraft(initialBrandDraft)
    setBrandError(null)
    setIsBrandEditing(false)
  }, [activeConfig?.id, initialBrandDraft])

  async function handleSaveBrandProfile() {
    if (!activeConfig || !activeTheme) return
    setIsBrandSaving(true)
    setBrandError(null)
    try {
      const token = localStorage.getItem('token')
      const nextValue = {
        ...activeTheme,
        brandName: brandDraft.brandName.trim(),
        brandShortName: brandDraft.brandShortName.trim(),
        productTitle: brandDraft.productTitle.trim(),
        productSubtitle: brandDraft.productSubtitle.trim(),
        loginTitle: brandDraft.loginTitle.trim(),
        loginSubtitle: brandDraft.loginSubtitle.trim(),
        brandAssets: {
          fullLogo: {
            light: brandDraft.fullLogoLight.trim(),
            dark: brandDraft.fullLogoDark.trim(),
          },
          symbol: {
            light: brandDraft.symbolLight.trim(),
            dark: brandDraft.symbolDark.trim(),
          },
          favicon: brandDraft.favicon.trim(),
        },
        logoUrl: brandDraft.symbolDark.trim() || brandDraft.fullLogoDark.trim() || brandDraft.symbolLight.trim() || brandDraft.fullLogoLight.trim(),
        faviconUrl: brandDraft.favicon.trim(),
      }
      const response = await fetch(`/api/configs/${activeConfig.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: activeConfig.name,
          value: nextValue,
          description: activeConfig.description || '',
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const message = data.error?.message || data.error || '品牌资料保存失败'
        setBrandError(message)
        return
      }

      setIsBrandEditing(false)
      await onRefresh?.()
    } catch {
      setBrandError('网络错误，品牌资料未保存')
    } finally {
      setIsBrandSaving(false)
    }
  }

  const updateBrandDraft = (patch: Partial<BrandProfileDraft>) => {
    setBrandDraft((current) => ({ ...current, ...patch }))
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>界面主题</CardTitle>
          <p className="mt-1 text-sm text-slate-500">品牌资料统一维护 Logo、Favicon 和浏览器标题；主题只管理颜色、圆角和外观变量。</p>
        </div>
        <Button onClick={onNew} className="w-full sm:w-auto">+ 新增主题</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">品牌资料（BrandProfile）</div>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">
                这里统一维护浏览器标题、侧栏品牌、登录页文案、Logo 和 Favicon；UI 主题只决定颜色和圆角。
              </p>
            </div>
            <div className="flex gap-2">
              {isBrandEditing ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => {
                    setBrandDraft(initialBrandDraft)
                    setIsBrandEditing(false)
                    setBrandError(null)
                  }}>
                    取消
                  </Button>
                  <Button size="sm" onClick={handleSaveBrandProfile} disabled={!activeConfig || isBrandSaving}>
                    {isBrandSaving ? '保存中...' : '保存品牌资料'}
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setIsBrandEditing(true)} disabled={!activeConfig}>
                  编辑品牌资料
                </Button>
              )}
            </div>
          </div>
          {activeConfig ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="grid gap-3 md:grid-cols-2">
                {isBrandEditing ? (
                  <>
                    <BrandInput label="品牌名称" value={brandDraft.brandName} onChange={(value) => updateBrandDraft({ brandName: value })} />
                    <BrandInput label="品牌简称" value={brandDraft.brandShortName} onChange={(value) => updateBrandDraft({ brandShortName: value })} />
                    <BrandInput label="浏览器标题" value={brandDraft.productTitle} onChange={(value) => updateBrandDraft({ productTitle: value })} />
                    <BrandInput label="侧栏副标题" value={brandDraft.productSubtitle} onChange={(value) => updateBrandDraft({ productSubtitle: value })} />
                    <BrandInput label="登录页标题" value={brandDraft.loginTitle} onChange={(value) => updateBrandDraft({ loginTitle: value })} />
                    <BrandInput label="登录页副标题" value={brandDraft.loginSubtitle} onChange={(value) => updateBrandDraft({ loginSubtitle: value })} />
                  </>
                ) : (
                  <>
                    <BrandReadField label="品牌名称" value={activeTheme?.brandName || '未配置'} />
                    <BrandReadField label="品牌简称" value={activeTheme?.brandShortName || '未配置'} />
                    <BrandReadField label="浏览器标题" value={activeTheme?.productTitle || '未配置'} />
                    <BrandReadField label="侧栏副标题" value={activeTheme?.productSubtitle || '未配置'} />
                    <BrandReadField label="登录页标题" value={activeTheme?.loginTitle || '未配置'} />
                    <BrandReadField label="登录页副标题" value={activeTheme?.loginSubtitle || '未配置'} />
                  </>
                )}
              </div>
              <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">运行时资产</div>
                {isBrandEditing ? (
                  <div className="space-y-3">
                    <BrandAssetUpload label="完整 Logo（浅色背景，保持原比例）" folder="logos" value={brandDraft.fullLogoLight} onChange={(value) => updateBrandDraft({ fullLogoLight: value })} />
                    <BrandAssetUpload label="完整 Logo（深色背景，保持原比例）" folder="logos" value={brandDraft.fullLogoDark} onChange={(value) => updateBrandDraft({ fullLogoDark: value })} />
                    <BrandAssetUpload label="折叠图形（浅色背景，任意比例）" folder="logos" value={brandDraft.symbolLight} onChange={(value) => updateBrandDraft({ symbolLight: value })} square />
                    <BrandAssetUpload label="折叠图形（深色背景，任意比例）" folder="logos" value={brandDraft.symbolDark} onChange={(value) => updateBrandDraft({ symbolDark: value })} square />
                    <BrandAssetUpload label="Favicon 源图（自动加透明方形画布）" folder="favicons" value={brandDraft.favicon} onChange={(value) => updateBrandDraft({ favicon: value })} square />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <BrandAssetPreview label="侧栏 Logo" value={activeLogo} fallback={activeTheme?.brandShortName || 'OS'} />
                    <BrandAssetPreview label="浏览器 Favicon" value={activeFavicon} fallback="ico" square />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              先新增并发布一个主题配置，系统会以该运行时配置承载当前阶段的 BrandProfile；后续可独立迁移为品牌资料配置表。
            </div>
          )}
          {brandError ? (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {brandError}
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-500">当前生效 UITheme</div>
              <div className="mt-1 text-base font-semibold text-slate-900">
                {activeConfig ? activeConfig.name : '未发布主题'}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {activeTheme
                  ? `${activeConfig?.key} · ${activeTheme.appearance} · radius ${activeTheme.radiusMd}/${activeTheme.radiusLg}`
                  : '发布一个主题后，运行时只更新颜色、圆角和外观变量。'}
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
            <ThemeRuntimeFact label="主题外观" value={activeTheme?.appearance || '未发布'} ready={Boolean(activeTheme)} />
            <ThemeRuntimeFact label="品牌资产" value={activeLogo || activeFavicon ? '来自 BrandProfile 运行时源' : '等待 BrandProfile 配置入口'} ready={Boolean(activeLogo || activeFavicon)} />
            <ThemeRuntimeFact label="边界" value="品牌资料统一维护 logo/favicon" ready />
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
                        <span>外观：{theme.appearance}</span>
                        <span>按钮圆角：{theme.radiusMd}px</span>
                        <span>卡片圆角：{theme.radiusLg}px</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        <span>品牌资产：{logo || favicon ? 'BrandProfile 运行时读取' : '等待品牌资料配置'}</span>
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

function BrandInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function BrandReadField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-slate-800">{value}</div>
    </div>
  )
}

function BrandAssetUpload({
  label,
  folder,
  value,
  onChange,
  square,
}: {
  label: string
  folder: 'logos' | 'favicons'
  value: string
  onChange: (value: string) => void
  square?: boolean
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-slate-600">{label}</div>
      <ImageUpload
        value={value}
        onChange={onChange}
        folder={folder}
        square={square}
        previewHeight={square ? 36 : 40}
        showUrlInput={folder !== 'favicons'}
        maxSizeMB={2}
      />
    </div>
  )
}

function BrandAssetPreview({
  label,
  value,
  fallback,
  square,
}: {
  label: string
  value: string
  fallback: string
  square?: boolean
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-2 flex ${square ? 'h-16' : 'h-20'} items-center justify-center rounded border border-slate-100 bg-slate-50`}>
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="rounded bg-slate-900 px-2 py-1 text-xs font-semibold text-white">{fallback}</span>
        )}
      </div>
    </div>
  )
}
