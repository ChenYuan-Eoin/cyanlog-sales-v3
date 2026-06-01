// REQ:F007
// PURPOSE: Export contract review results as Word document with comments

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { generateWordDocument } from '@/lib/export/word-generator'
import fs from 'fs'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// POST /api/contracts/:id/export - 导出带批注的Word文档
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(req)
    const { id } = params

    if (!id) {
      return errorResponse('合同ID必填', 400, 'MISSING_ID')
    }

    // 获取合同和审核结果
    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .select('*, contract_reviews(*)')
      .eq('id', id)
      .eq('created_by', user.id)
      .single()

    if (contractError || !contract) {
      return errorResponse('合同不存在', 404, 'NOT_FOUND')
    }

    // 检查是否有审核结果
    const latestReview = contract.contract_reviews?.[0]
    if (!latestReview || !latestReview.results) {
      return errorResponse('合同尚未完成审核', 400, 'NO_REVIEW_RESULTS')
    }

    // 获取审核结果中的风险项
    const results = latestReview.results as {
      risks?: Array<{
        level: 'red' | 'yellow' | 'green'
        title: string
        description: string
        suggestion: string
      }>
    }

    const comments = results.risks || []

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

    // Generate Word document with comments
    const exportResult = await generateWordDocument(inputPath, comments)

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

    return new NextResponse(fileBuffer, { headers })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Export error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
