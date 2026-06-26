// GET /api/tenders/:id/workflow - 获取标书工作流状态
// POST /api/tenders/:id/workflow - 推进工作流
// PATCH /api/tenders/:id/workflow - 更新步骤数据

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import {
  STEP_ORDER,
  STEP_CONFIG,
  getNextStep,
  getPrevStep,
  getStepProgress,
  type TenderStep,
} from '@/lib/tender/workflow'

const workflowMoveSchema = z.object({
  direction: z.enum(['next', 'prev']).default('next'),
})

const workflowCheckpointSchema = z.object({
  checkpoint_data: z.record(z.string(), z.unknown()).optional(),
})

function validationError(message: string) {
  return NextResponse.json({ error: message, code: 'VALIDATION_ERROR' }, { status: 400 })
}

// GET /api/tenders/:id/workflow
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { id } = await params

    const { data: tender, error } = await supabaseAdmin
      .from('tenders')
      .select('id, workflow_step, status, checkpoint_data, org_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (error || !tender) {
      return NextResponse.json({ error: '标书不存在' }, { status: 404 })
    }

    const currentStep = (tender.workflow_step || 'document-import') as TenderStep
    const idx = STEP_ORDER.indexOf(currentStep)

    return NextResponse.json({
      data: {
        id: tender.id,
        currentStep,
        completedSteps: STEP_ORDER.slice(0, idx),
        canProceed: tender.status !== 'completed',
        canGoBack: idx > 0,
        progress: getStepProgress(currentStep),
        checkpointData: tender.checkpoint_data || {},
        steps: STEP_ORDER.map((step) => ({
          id: step,
          label: STEP_CONFIG[step].label,
          description: STEP_CONFIG[step].description,
          isCompleted: idx > STEP_ORDER.indexOf(step),
          isCurrent: step === currentStep,
        })),
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 })
    }
    console.error('Get workflow error:', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}

// POST /api/tenders/:id/workflow - 推进到下一步或上一步
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { id } = await params
    const parsed = workflowMoveSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return validationError('工作流方向无效')
    }
    const { direction } = parsed.data

    const { data: tender, error } = await supabaseAdmin
      .from('tenders')
      .select('id, workflow_step, status, org_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (error || !tender) {
      return NextResponse.json({ error: '标书不存在' }, { status: 404 })
    }

    const currentStep = (tender.workflow_step || 'document-import') as TenderStep
    const nextStep = direction === 'next' ? getNextStep(currentStep) : getPrevStep(currentStep)

    if (!nextStep) {
      return NextResponse.json({ error: '无法继续' }, { status: 400 })
    }

    const newStatus = nextStep === 'completed' ? 'completed' : tender.status
    const { error: updateError } = await supabaseAdmin
      .from('tenders')
      .update({
        workflow_step: nextStep,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) {
      return NextResponse.json({ error: '更新失败' }, { status: 500 })
    }

    return NextResponse.json({
      data: {
        currentStep: nextStep,
        progress: getStepProgress(nextStep),
        status: newStatus,
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 })
    }
    console.error('Update workflow error:', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}

// PATCH /api/tenders/:id/workflow - 更新当前步骤数据
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { id } = await params
    const parsed = workflowCheckpointSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return validationError('步骤数据无效')
    }
    const { checkpoint_data } = parsed.data

    const { error } = await supabaseAdmin
      .from('tenders')
      .update({
        checkpoint_data: checkpoint_data || {},
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)

    if (error) {
      return NextResponse.json({ error: '保存失败' }, { status: 500 })
    }

    return NextResponse.json({ data: { message: '保存成功' } })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 })
    }
    console.error('Patch workflow error:', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
