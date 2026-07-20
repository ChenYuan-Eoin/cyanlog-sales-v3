'use client'

import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { CloseIcon } from '@/components/icons'
import { getAIConfigKind, isAIPlatformAssetKind } from '@/lib/configs/ai-config-kind'
import type { Config, EditableConfig } from '../types'

function DialogChunkFallback() {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
      加载编辑表单...
    </div>
  )
}

const TaxEditForm = dynamic(() => import('./TaxEditForm'), {
  loading: DialogChunkFallback,
  ssr: false,
})

const ApprovalEditForm = dynamic(() => import('./ApprovalEditForm'), {
  loading: DialogChunkFallback,
  ssr: false,
})

const AIEditForm = dynamic(() => import('./AIEditForm'), {
  loading: DialogChunkFallback,
  ssr: false,
})

const ThemeEditForm = dynamic(() => import('./ThemeEditForm'), {
  loading: DialogChunkFallback,
  ssr: false,
})

const CONFIG_TYPE_META: Record<string, { label: string }> = {
  CONTRACT_RULE: { label: '合同审核策略' },
  TAX_RULE: { label: '税率规则' },
  APPROVAL_RULE: { label: '审批权限' },
  AI_CONFIG: { label: 'AI 平台资产' },
  UI_THEME: { label: '界面主题' },
}

interface ConfigEditDialogProps {
  open: boolean
  configType: Config['type']
  config: EditableConfig
  configs: Config[]
  error: string
  saving: boolean
  onOpenChange: (open: boolean) => void
  onConfigChange: (config: EditableConfig) => void
  onSave: () => void | Promise<void>
}

export default function ConfigEditDialog({
  open,
  configType,
  config,
  configs,
  error,
  saving,
  onOpenChange,
  onConfigChange,
  onSave,
}: ConfigEditDialogProps) {
  const aiKind = configType === 'AI_CONFIG' ? getAIConfigKind(config.value) : null
  const isReadOnlyAIAsset = configType === 'AI_CONFIG' && !isAIPlatformAssetKind(aiKind)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-busy={saving}
        className="flex max-h-[88vh] flex-col overflow-hidden p-0 sm:max-w-4xl"
      >
        <DialogHeader className="relative shrink-0 border-b border-slate-200 px-6 py-5 pr-16">
          <DialogTitle>
            {config.id ? '编辑配置' : `新建${CONFIG_TYPE_META[configType]?.label || '配置'}`}
          </DialogTitle>
          <Button
            type="button"
            variant="ghost"
            aria-label="关闭编辑窗口"
            className="absolute right-3 top-1/2 min-h-11 min-w-11 -translate-y-1/2"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            <CloseIcon size={18} />
          </Button>
        </DialogHeader>

        <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-6 py-5">
          {configType === 'TAX_RULE' && <TaxEditForm config={config} onChange={onConfigChange} />}
          {configType === 'APPROVAL_RULE' && <ApprovalEditForm config={config} onChange={onConfigChange} />}
          {configType === 'AI_CONFIG' && !isReadOnlyAIAsset && (
            <AIEditForm
              key={config.id || config.key || 'new-ai-asset'}
              config={config}
              configs={configs}
              onChange={onConfigChange}
            />
          )}
          {configType === 'UI_THEME' && <ThemeEditForm config={config} onChange={onConfigChange} />}

          {isReadOnlyAIAsset ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              该记录属于{aiKind === 'provider' ? '旧混合 Provider' : aiKind === 'application' ? '旧模型应用' : aiKind === 'tool_policy' ? '旧工具策略' : '未知 AI 资产'}，
              只作为运行切换前的兼容记录保留，不能继续通过混合表单修改。
            </div>
          ) : (
            <div className="mt-4">
              <label htmlFor="config-description" className="text-sm font-medium">描述</label>
              <Textarea
                id="config-description"
                name="config-description"
                autoComplete="off"
                value={config.description || ''}
                onChange={(event) => onConfigChange({ ...config, description: event.target.value })}
                placeholder="配置描述（可选）"
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 border-t border-slate-200 bg-white px-6 py-4">
          <Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={() => onOpenChange(false)}>
            {isReadOnlyAIAsset ? '关闭' : '取消'}
          </Button>
          {!isReadOnlyAIAsset && (
            <Button type="button" className="min-h-11" disabled={saving} onClick={() => void onSave()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
