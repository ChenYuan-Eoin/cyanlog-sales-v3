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
import type { Config } from '../types'

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
  AI_CONFIG: { label: 'AI 配置' },
  UI_THEME: { label: '界面主题' },
}

interface ConfigEditDialogProps {
  open: boolean
  configType: Config['type']
  config: Partial<Config>
  onOpenChange: (open: boolean) => void
  onConfigChange: (config: Partial<Config>) => void
  onSave: () => void | Promise<void>
}

export default function ConfigEditDialog({
  open,
  configType,
  config,
  onOpenChange,
  onConfigChange,
  onSave,
}: ConfigEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {config.id ? '编辑配置' : `新建${CONFIG_TYPE_META[configType]?.label || '配置'}`}
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {configType === 'TAX_RULE' && <TaxEditForm config={config} onChange={onConfigChange} />}
          {configType === 'APPROVAL_RULE' && <ApprovalEditForm config={config} onChange={onConfigChange} />}
          {configType === 'AI_CONFIG' && <AIEditForm config={config} onChange={onConfigChange} />}
          {configType === 'UI_THEME' && <ThemeEditForm config={config} onChange={onConfigChange} />}

          <div className="mt-4">
            <label className="text-sm font-medium">描述</label>
            <Textarea
              value={config.description || ''}
              onChange={(event) => onConfigChange({ ...config, description: event.target.value })}
              placeholder="配置描述（可选）"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={onSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
