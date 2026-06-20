'use client'

// 标书工作流引擎 UI 组件 (P2-4)
// 在 tender/[id]/page.tsx 中引用

import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileUpIcon,
  SearchIcon,
  ListIcon,
  Settings2Icon,
  PenToolIcon,
  CheckCircleIcon,
  Loader2Icon,
} from 'lucide-react'
import { error } from '@/lib/toast'

interface WorkflowStep {
  id: string
  label: string
  description: string
  isCompleted: boolean
  isCurrent: boolean
}

interface TenderWorkflowData {
  id: string
  currentStep: string
  completedSteps: string[]
  canProceed: boolean
  canGoBack: boolean
  progress: number
  checkpointData: Record<string, unknown>
  steps: WorkflowStep[]
}

interface TenderWorkflowProps {
  tenderId: string
  initialData?: TenderWorkflowData
}

const STEP_ICONS: Record<string, typeof FileUpIcon> = {
  'document-import': FileUpIcon,
  'bid-analysis': SearchIcon,
  'outline': ListIcon,
  'global-facts': Settings2Icon,
  'content-edit': PenToolIcon,
  'completed': CheckCircleIcon,
}

export default function TenderWorkflow({ tenderId, initialData }: TenderWorkflowProps) {
  const [workflow, setWorkflow] = useState<TenderWorkflowData | null>(initialData || null)
  const [loading, setLoading] = useState(!initialData)
  const [actionLoading, setActionLoading] = useState(false)

  const fetchWorkflow = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/tenders/${tenderId}/workflow`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setWorkflow(data.data)
      }
    } catch (err) {
      console.warn('获取工作流失败', err)
    } finally {
      setLoading(false)
    }
  }, [tenderId])

  useEffect(() => {
    if (!initialData) {
      void fetchWorkflow()
    }
  }, [fetchWorkflow, initialData])

  const handleStep = useCallback(
    async (direction: 'next' | 'prev') => {
      setActionLoading(true)
      try {
        const token = localStorage.getItem('token')
        const res = await fetch(`/api/tenders/${tenderId}/workflow`, {
          method: 'POST',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ direction }),
        })
        if (res.ok) {
          const data = await res.json()
          setWorkflow((prev) =>
            prev
              ? {
                  ...prev,
                  currentStep: data.data.currentStep,
                  progress: data.data.progress,
                  status: data.data.status,
                }
              : null
          )
        }
      } catch {
        error('操作失败')
      } finally {
        setActionLoading(false)
      }
    },
    [tenderId]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2Icon className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!workflow) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p>无法获取工作流状态</p>
      </div>
    )
  }

  const currentStepIndex = workflow.steps.findIndex((s) => s.isCurrent)

  return (
    <div className="space-y-6">
      {/* 进度条 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">工作流进度</span>
          <span className="text-sm text-slate-500">{workflow.progress}%</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${workflow.progress}%` }}
          />
        </div>
      </div>

      {/* 步骤导航 */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {workflow.steps.map((step, index) => {
          const Icon = STEP_ICONS[step.id] || FileUpIcon
          const isActive = step.isCurrent
          const isDone = step.isCompleted

          return (
            <div key={step.id} className="flex items-center">
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg whitespace-nowrap transition ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : isDone
                    ? 'bg-green-50 text-green-700'
                    : 'text-slate-500'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="text-sm font-medium">{step.label}</span>
                {isDone && <CheckCircleIcon className="h-3 w-3 text-green-500" />}
              </div>
              {index < workflow.steps.length - 1 && (
                <div className="w-4 h-px bg-slate-200 mx-1" />
              )}
            </div>
          )
        })}
      </div>

      {/* 当前步骤详情 */}
      {currentStepIndex >= 0 && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {workflow.steps[currentStepIndex].label}
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  {workflow.steps[currentStepIndex].description}
                </p>
              </div>
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                当前步骤
              </Badge>
            </div>

            {/* 步骤内容区 - 根据当前步骤显示不同内容 */}
            <div className="mt-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
              <StepContent
                step={workflow.steps[currentStepIndex].id}
                checkpointData={workflow.checkpointData}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* 导航按钮 */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          disabled={!workflow.canGoBack || actionLoading}
          onClick={() => handleStep('prev')}
        >
          <ChevronLeftIcon className="h-4 w-4 mr-1" />
          上一步
        </Button>
        <Button
          disabled={!workflow.canProceed || actionLoading}
          onClick={() => handleStep('next')}
        >
          {actionLoading ? (
            <Loader2Icon className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 mr-1" />
          )}
          下一步
        </Button>
      </div>
    </div>
  )
}

// 各步骤内容组件
function StepContent({
  step,
  checkpointData: _checkpointData,
}: {
  step: string
  checkpointData: Record<string, unknown>
}) {
  switch (step) {
    case 'document-import':
      return (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">请上传招标文件（支持 PDF / DOCX / TXT 格式）</p>
          <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors cursor-pointer">
            <FileUpIcon className="h-8 w-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-500">拖拽文件到此处或点击上传</p>
          </div>
        </div>
      )
    case 'bid-analysis':
      return (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">AI 正在分析招标文件要求...</p>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2Icon className="h-4 w-4 animate-spin" />
            分析中
          </div>
        </div>
      )
    case 'outline':
      return (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">基于分析结果生成标书大纲</p>
          <div className="space-y-2">
            {['项目概述', '公司资质', '技术方案', '商务报价', '服务承诺'].map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-slate-700">
                <span className="text-slate-400 font-mono">{i + 1}.</span>
                {item}
              </div>
            ))}
          </div>
        </div>
      )
    case 'global-facts':
      return (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">设置全局变量，确保全文一致性</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-500 block mb-1">项目名称</label>
              <input type="text" className="w-full border rounded px-3 py-1.5 text-sm" placeholder="输入项目名称" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">投标方</label>
              <input type="text" className="w-full border rounded px-3 py-1.5 text-sm" placeholder="输入投标方名称" />
            </div>
          </div>
        </div>
      )
    case 'content-edit':
      return (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">逐章编写和完善标书内容</p>
          <div className="border rounded-lg p-4 min-h-[200px]">
            <p className="text-sm text-slate-400">在此编辑标书正文...</p>
          </div>
        </div>
      )
    case 'completed':
      return (
        <div className="text-center py-8">
          <CheckCircleIcon className="h-12 w-12 text-green-500 mx-auto mb-3" />
          <h4 className="text-lg font-semibold text-slate-900">标书已完成</h4>
          <p className="text-sm text-slate-500 mt-1">所有步骤已完成，可以导出标书</p>
        </div>
      )
    default:
      return <p className="text-sm text-slate-500">暂无内容</p>
  }
}
