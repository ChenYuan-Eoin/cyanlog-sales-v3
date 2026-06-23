'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  CheckCircleIcon,
  XCircleIcon,
  AlertCircleIcon,
  LoaderIcon,
} from 'lucide-react'

// AI 降级链路 4 层
interface DegradationLayer {
  id: string
  status: 'completed' | 'running' | 'skipped' | 'failed' | 'pending'
  durationMs?: number
  detail?: string
}

interface DegradationStatus {
  layers: DegradationLayer[]
  totalDurationMs: number
  degraded: boolean
}

interface AiDegradationBarProps {
  status?: DegradationStatus
}

const layerConfig: Record<string, { label: string }> = {
  local: { label: '本地 LLM' },
  cloud: { label: '云端 LLM' },
  rules: { label: '规则引擎' },
  manual: { label: '人工补判' },
}

function LayerItem({ layer, index }: { layer: DegradationLayer; index: number }) {
  const configLabel = layerConfig[layer.id]?.label || layer.id

  const statusConfig = {
    completed: { color: 'text-green-600', bg: 'bg-green-50', badge: '已完成' },
    running: { color: 'text-blue-600', bg: 'bg-blue-50', badge: '执行中' },
    skipped: { color: 'text-slate-400', bg: 'bg-slate-50', badge: '未触发' },
    failed: { color: 'text-red-600', bg: 'bg-red-50', badge: '失败' },
    pending: { color: 'text-slate-400', bg: 'bg-slate-50', badge: '待执行' },
  }

  const cfg = statusConfig[layer.status]

  return (
    <div className="flex items-start gap-3">
      {/* 步骤编号 */}
      <div className="flex flex-col items-center">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold shrink-0 ${
            layer.status === 'completed'
              ? 'bg-green-100 text-green-600'
              : layer.status === 'running'
                ? 'bg-blue-100 text-blue-600'
                : layer.status === 'failed'
                  ? 'bg-red-100 text-red-600'
                  : 'bg-slate-100 text-slate-400'
          }`}
        >
          {layer.status === 'running' ? (
            <LoaderIcon className="h-4 w-4 animate-spin" />
          ) : layer.status === 'completed' ? (
            <CheckCircleIcon className="h-4 w-4" />
          ) : layer.status === 'failed' ? (
            <XCircleIcon className="h-4 w-4" />
          ) : (
            index + 1
          )}
        </div>
        {index < 3 && (
          <div className="h-full w-px bg-slate-200 mt-1 flex-1 min-h-[24px]" />
        )}
      </div>

      {/* 内容 */}
      <div className="flex-1 pb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-900">{configLabel}</span>
          <Badge variant="outline" className={`text-xs ${cfg.color}`}>
            {cfg.badge}
          </Badge>
          {layer.durationMs && layer.status === 'completed' && (
            <span className="text-xs text-slate-500">
              {(layer.durationMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>
        {layer.detail && (
          <p className="text-xs text-slate-500 mt-1">{layer.detail}</p>
        )}
      </div>
    </div>
  )
}

export default function AiDegradationBar({ status }: AiDegradationBarProps) {
  // 默认数据（审核中）
  const defaultLayers: DegradationLayer[] = [
    { id: 'local', status: 'completed', durationMs: 8500, detail: 'gpt-oss / qwen2.5' },
    { id: 'cloud', status: 'running', detail: 'Claude / OpenAI / DeepSeek' },
    { id: 'rules', status: 'pending', detail: '15条规则引擎扫描' },
    { id: 'manual', status: 'pending', detail: '等待人工补判' },
  ]

  const layers = status?.layers || defaultLayers
  const totalDuration = status?.totalDurationMs || 0
  const degraded = status?.degraded || false

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">AI 降级链路</CardTitle>
          {degraded && (
            <Badge variant="secondary" className="text-xs text-amber-600">
              已降级
            </Badge>
          )}
          {totalDuration > 0 && (
            <span className="text-xs text-slate-500">
              总耗时: {(totalDuration / 1000).toFixed(1)}s
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-0">
          {layers.map((layer, index) => (
            <LayerItem key={layer.id} layer={layer} index={index} />
          ))}
        </div>

        {/* 降级提示 */}
        {degraded && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <div className="flex items-center gap-2">
              <AlertCircleIcon className="h-4 w-4" />
              <span className="font-medium">当前结果来自降级路径，建议人工复核。</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
