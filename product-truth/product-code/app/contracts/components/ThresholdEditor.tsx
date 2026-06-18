'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// 3级阈值结构
export interface ThresholdConfig {
  lower: number | string       // 下限（强提醒）
  recommended: string         // 建议区间（绿灯）
  redLine: number | string     // 红线（强阻塞）
  unit?: string                // 单位: percent / days / times / amount
}

interface ThresholdEditorProps {
  value: ThresholdConfig
  onChange: (value: ThresholdConfig) => void
  disabled?: boolean
}

// 单位显示
const unitLabels: Record<string, string> = {
  percent: '%',
  days: '天',
  times: '次',
  amount: '元',
  years: '年',
  months: '月',
}

// 预设规则模板
const ruleTemplates: Record<string, { label: string; default: ThresholdConfig }> = {
  PAYMENT_SCHEDULE: {
    label: '付款节奏',
    default: { lower: 30, recommended: '30-100', redLine: 25, unit: 'percent' },
  },
  EARLY_TERMINATION_REFUND: {
    label: '终止退款',
    default: { lower: '不退款', recommended: '仅退未消耗', redLine: '全额退款', unit: 'times' },
  },
  TAX_RATE: {
    label: '税率',
    default: { lower: '13%软件', recommended: '13%软件/6%订阅', redLine: '错套', unit: 'percent' },
  },
  DEFAULT_ACCEPTANCE_PERIOD: {
    label: '默示验收期',
    default: { lower: 5, recommended: '7-15', redLine: 30, unit: 'days' },
  },
  ACCEPTANCE_FAILURE: {
    label: '验收不通过',
    default: { lower: '整改重交', recommended: '2次后解除', redLine: '直接解除', unit: 'times' },
  },
  LIQUIDATED_DAMAGES: {
    label: '违约金',
    default: { lower: 50, recommended: '50-100', redLine: 100, unit: 'percent' },
  },
  CONSEQUENTIAL_LOSS: {
    label: '间接损失',
    default: { lower: '明确排除', recommended: '需补', redLine: '承担间接', unit: 'times' },
  },
  LIABILITY_CAP: {
    label: '责任 Cap',
    default: { lower: 50, recommended: '50-100', redLine: 100, unit: 'percent' },
  },
  CONFIDENTIALITY_PERIOD: {
    label: '保密期',
    default: { lower: 5, recommended: '3-7', redLine: '单向/永久', unit: 'years' },
  },
  PARTY_AND_AMOUNT: {
    label: '主体·收款·金额',
    default: { lower: '全对', recommended: '旧版模板', redLine: '错主体', unit: 'times' },
  },
  IP_OWNERSHIP: {
    label: 'IP 归属',
    default: { lower: 'ONES保留', recommended: '二次开发让', redLine: '客户主张', unit: 'times' },
  },
  DATA_SECURITY: {
    label: '数据安全',
    default: { lower: '客户所有', recommended: '加密本地化', redLine: 'AI训练无授权', unit: 'times' },
  },
}

export default function ThresholdEditor({ value, onChange, disabled }: ThresholdEditorProps) {
  const isNumeric = typeof value.lower === 'number' && typeof value.redLine === 'number'
  const unitLabel = unitLabels[value.unit || 'percent'] || ''

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">柔性化 3 级阈值</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 可视化条 */}
        {isNumeric && (
          <div className="relative h-6 rounded-lg overflow-hidden flex">
            <div className="flex-1 bg-green-500 h-full flex items-center justify-center text-white text-xs font-medium">
              绿灯区间
            </div>
            <div className="flex-1 bg-yellow-400 h-full flex items-center justify-center text-white text-xs font-medium">
              黄灯提醒
            </div>
            <div className="flex-1 bg-red-500 h-full flex items-center justify-center text-white text-xs font-medium">
              红灯阻塞
            </div>
          </div>
        )}

        {/* 3级阈值输入 */}
        <div className="grid grid-cols-3 gap-4">
          {/* 下限（强提醒） */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-yellow-400" />
              <Label className="text-sm font-medium text-yellow-700">下限（强提醒）</Label>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={String(value.lower)}
                onChange={(e) => onChange({ ...value, lower: e.target.value })}
                disabled={disabled}
                className="flex-1"
                placeholder={isNumeric ? "如：30" : "如：不退款"}
              />
              {unitLabel && <span className="text-sm text-slate-500">{unitLabel}</span>}
            </div>
            <p className="text-xs text-slate-500">低于此值标黄，AI解释让步空间</p>
          </div>

          {/* 建议区间（绿灯） */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <Label className="text-sm font-medium text-green-700">建议区间（绿灯）</Label>
            </div>
            <Input
              value={String(value.recommended)}
              onChange={(e) => onChange({ ...value, recommended: e.target.value })}
              disabled={disabled}
              className="w-full"
              placeholder={isNumeric ? "如：30-100" : "如：仅退未消耗"}
            />
            <p className="text-xs text-slate-500">在此区间直接通过</p>
          </div>

          {/* 红线（强阻塞） */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <Label className="text-sm font-medium text-red-700">红线（强阻塞）</Label>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={String(value.redLine)}
                onChange={(e) => onChange({ ...value, redLine: e.target.value })}
                disabled={disabled}
                className="flex-1"
                placeholder={isNumeric ? "如：25" : "如：全额退款"}
              />
              {unitLabel && <span className="text-sm text-slate-500">{unitLabel}</span>}
            </div>
            <p className="text-xs text-slate-500">触达必须修改，不能签字</p>
          </div>
        </div>

        {/* 预览说明 */}
        <div className="rounded-lg bg-slate-50 p-4 text-sm">
          <p className="font-medium text-slate-700 mb-2">当前阈值解读：</p>
          <div className="space-y-1 text-slate-600">
            <p>
              <span className="text-yellow-600 font-medium">{String(value.lower)}{unitLabel}</span>
              {' '}以下 = 强提醒（建议调整）
            </p>
            <p>
              <span className="text-green-600 font-medium">{String(value.recommended)}</span>
              {' '}= 绿灯区间（直接通过）
            </p>
            <p>
              <span className="text-red-600 font-medium">{String(value.redLine)}{unitLabel}</span>
              {' '}以下 = 红线（必须修改）
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// 导出模板获取函数
export function getRuleTemplate(ruleCode: string): ThresholdConfig {
  return ruleTemplates[ruleCode]?.default || { lower: 0, recommended: '0-100', redLine: 0, unit: 'percent' }
}

export { ruleTemplates }
