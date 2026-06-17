// REQ:F007
// PURPOSE: Export contract review results as Word document with comments

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { generateWordDocument } from '@/lib/export/word-generator'
import fs from 'fs'
import { getRequestId, logRouteDone, logRouteFailure, logRouteStart } from '@/lib/observability'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// POST /api/contracts/:id/export - 导出带批注的Word文档
export async function POST(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const route = '/api/contracts/[id]/export'
  let routeId = ''

  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)
    routeId = await resolveIdParam(params)
    const id = routeId
    logRouteStart({
      route,
      requestId,
      userId: user.id,
      details: { contractId: id },
    })

    if (!id) {
      return errorResponse('合同ID必填', 400, 'MISSING_ID')
    }

    // 获取合同和审核结果
    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .select('*, contract_reviews(*)')
      .eq('id', id)
      .in('created_by', accessibleUserIds)
      .maybeSingle()

    if (contractError || !contract) {
      return errorResponse('合同不存在', 404, 'NOT_FOUND')
    }

    if (Array.isArray(contract.contract_reviews)) {
      contract.contract_reviews = contract.contract_reviews.sort((
        a: { created_at: string },
        b: { created_at: string }
      ) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    }

    // 检查是否有审核结果
    const latestReview = contract.contract_reviews?.[0]
    if (!latestReview || !latestReview.results) {
      return errorResponse('合同尚未完成审核', 400, 'NO_REVIEW_RESULTS')
    }

    // 获取审核结果中的风险项
    const reviewResults = latestReview.results as {
      summary?: string
      risks?: Array<{
        level: 'red' | 'yellow' | 'green'
        title: string
        description: string
        suggestion: string
      }>
    }

    // 获取结构化报告字段
    const riskSummary = (latestReview as unknown as { risk_summary?: {
      total_clauses: number
      critical_risks: number
      high_risks: number
      medium_risks: number
      low_risks: number
      compliance_score: number
      strategy_code?: string
    } }).risk_summary

    const complianceCheck = (latestReview as unknown as { compliance_check?: {
      missing_required_clauses: string[]
      dangerous_clauses: string[]
      ambiguous_clauses: string[]
      unbalanced_clauses: string[]
      party_a_consistency: string
      party_b_consistency: string
      issues: string[]
    } }).compliance_check

    const effectivenessAnalysis = (latestReview as unknown as { effectiveness_analysis?: string }).effectiveness_analysis

    // 加载合同条款（按 position 排序）
    const { data: clauses } = await supabaseAdmin
      .from('contract_clauses')
      .select('id, clause_number, clause_title, clause_text, risk_level, risk_category, risk_description, legal_basis, suggestion, position')
      .eq('review_id', latestReview.id)
      .order('position', { ascending: true })

    // 加载批注
    const { data: annotations } = await supabaseAdmin
      .from('contract_annotations')
      .select('id, start_offset, end_offset, selected_text, comment, category, priority, status, author_id, created_at')
      .eq('contract_id', id)
      .order('created_at', { ascending: true })

    // 加载策略名称
    let strategyName = ''
    if (riskSummary?.strategy_code) {
      const { data: strategy } = await supabaseAdmin
        .from('review_strategies')
        .select('name')
        .eq('code', riskSummary.strategy_code)
        .or('org_id.is.null,org_id.eq.' + orgId)
        .limit(1)
        .maybeSingle()
      strategyName = strategy?.name || riskSummary.strategy_code
    }

    const exportData = {
      summary: reviewResults.summary,
      risks: reviewResults.risks || [],
      risk_summary: riskSummary,
      compliance_check: complianceCheck,
      effectiveness_analysis: effectivenessAnalysis,
      clauses: clauses || [],
      annotations: annotations || [],
      strategy_name: strategyName,
      strategy_code: riskSummary?.strategy_code,
    }

    // 下载原始合同文件
    const { data: fileData, error: fileError } = await supabaseAdmin.storage
      .from('contracts')
      .download(contract.storage_path)

    if (fileError) {
      console.error('Download file error:', fileError)
      // Continue without original file - will create new document
    }

    // Save to temp file if download succeeded
    let inputPath = ''
    if (fileData) {
      const tempInputPath = `/tmp/contract-${id}-input.docx`
      const buffer = Buffer.from(await fileData.arrayBuffer())
      fs.writeFileSync(tempInputPath, buffer)
      inputPath = tempInputPath
    }

    // Generate Word document with structured report + comments
    const exportResult = await generateWordDocument(inputPath, exportData)

    // Clean up temp input file
    if (inputPath && fs.existsSync(inputPath)) {
      fs.unlinkSync(inputPath)
    }

    if (!exportResult.success || !exportResult.outputPath) {
      return errorResponse(
        exportResult.error || '文档生成失败',
        500,
        'EXPORT_FAILED'
      )
    }

    // Read the generated file
    const fileBuffer = fs.readFileSync(exportResult.outputPath)

    // Clean up temp output file
    fs.unlinkSync(exportResult.outputPath)

    // Return file as download
    const headers = new Headers()
    headers.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    headers.set(
      'Content-Disposition',
      `attachment; filename="contract-${contract.filename}-审核结果.docx"`
    )

    logRouteDone(
      {
        route,
        requestId,
        userId: user.id,
        details: { contractId: id },
      },
      startedAt,
      {
        reviewId: latestReview.id,
      }
    )

    return new NextResponse(fileBuffer, { headers })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    await logRouteFailure(
      req,
      {
        route,
        requestId,
        details: { contractId: routeId },
      },
      startedAt,
      error
    )
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
