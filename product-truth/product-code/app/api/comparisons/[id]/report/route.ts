import { NextRequest, NextResponse } from 'next/server'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { createApiError } from '@/lib/api/errors'
import { errorResponse } from '@/lib/api/common'
import type { AuthUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import {
  downloadFrozenComparisonSource,
  loadFrozenComparisonSource,
  type FrozenComparisonSource,
} from '@/lib/contracts/comparison-snapshot-server'
import {
  ComparisonReportValidationError,
  generateComparisonReportDocx,
  type ComparisonReportDiff,
  type ComparisonReportStatistics,
} from '@/lib/export/comparison-report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface StoredPosition {
  page?: number
  page_number?: number
  start?: number
  end?: number
  start_offset?: number
  end_offset?: number
  start_offset_utf16?: number
  end_offset_utf16?: number
  locator?: 'rendered' | 'provisional'
}

function reportPosition(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const position = value as StoredPosition
  const pageNumber = position.page_number ?? position.page
  const startOffset = position.start_offset ?? position.start_offset_utf16 ?? position.start
  const endOffset = position.end_offset ?? position.end_offset_utf16 ?? position.end
  if (
    !Number.isSafeInteger(pageNumber)
    || !Number.isSafeInteger(startOffset)
    || !Number.isSafeInteger(endOffset)
    || (position.locator !== 'rendered' && position.locator !== 'provisional')
  ) {
    return null
  }
  return {
    page_number: pageNumber as number,
    start_offset: startOffset as number,
    end_offset: endOffset as number,
    locator: position.locator,
  }
}

function positionMatchesFrozenText(
  source: FrozenComparisonSource,
  position: { page_number: number; start_offset: number; end_offset: number; locator: 'rendered' | 'provisional' },
  exactText: string,
) {
  const { start_offset: start, end_offset: end, page_number: pageNumber } = position
  if (start < 0 || end < start || end > source.parsed_text.length) return false
  const page = source.page_map.pages.find((entry) => entry.page === pageNumber)
  if (!page || page.start > start || page.locator !== position.locator) return false
  const withinPage = end > start ? page.end >= end - 1 : page.end + 1 >= start
  return withinPage && source.parsed_text.slice(start, end) === exactText
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id } = await params
    const [{ data: comparison, error: comparisonError }, oldSource, newSource] = await Promise.all([
      supabaseAdmin
        .from('contract_comparisons')
        .select('id,org_id,status,completed_at')
        .eq('id', id)
        .eq('org_id', orgId)
        .maybeSingle(),
      loadFrozenComparisonSource(id, 'old', orgId),
      loadFrozenComparisonSource(id, 'new', orgId),
    ])

    if (comparisonError) return errorResponse(createApiError('DB_ERROR', '查询比对记录失败'))
    if (!comparison) return errorResponse(createApiError('NOT_FOUND', '比对记录不存在或无权访问'))
    if (comparison.status !== 'completed') {
      return errorResponse(createApiError('CONFLICT', '比对尚未完成，不能生成报告'), 409)
    }
    if (!comparison.completed_at || !Number.isFinite(Date.parse(comparison.completed_at))) {
      return errorResponse(createApiError('CONFLICT', '比对缺少可信完成时间，不能生成可审计报告'), 409)
    }
    if (!oldSource || !newSource) {
      return errorResponse(createApiError('CONFLICT', '缺少创建时旧/新原文件快照，不能生成可审计报告'), 409)
    }
    try {
      await Promise.all([
        downloadFrozenComparisonSource(oldSource, { forceStorageVerification: true }),
        downloadFrozenComparisonSource(newSource, { forceStorageVerification: true }),
      ])
    } catch {
      return errorResponse(createApiError(
        'CONFLICT',
        '冻结原文件副本缺失或摘要不一致，不能生成可审计报告',
      ), 409)
    }

    const { data: storedDiffs, error: diffsError } = await supabaseAdmin
      .from('comparison_diffs')
      .select('id,diff_type,risk_level,baseline_text,compare_text,baseline_position,compare_position,sort_order')
      .eq('comparison_id', id)
      .order('sort_order', { ascending: true })
    if (diffsError) return errorResponse(createApiError('DB_ERROR', '查询差异明细失败'))

    const diffs: ComparisonReportDiff[] = []
    for (const stored of storedDiffs || []) {
      const oldPosition = reportPosition(stored.baseline_position)
      const newPosition = reportPosition(stored.compare_position)
      if (!oldPosition || !newPosition) {
        return errorResponse(createApiError(
          'CONFLICT',
          `差异 ${stored.id} 缺少双侧原文位置，不能生成假报告`,
        ), 409)
      }
      if (
        !positionMatchesFrozenText(oldSource, oldPosition, stored.baseline_text || '')
        || !positionMatchesFrozenText(newSource, newPosition, stored.compare_text || '')
      ) {
        return errorResponse(createApiError(
          'CONFLICT',
          `差异 ${stored.id} 的双侧原文与冻结 UTF-16 位置不一致，不能生成假报告`,
        ), 409)
      }
      diffs.push({
        id: stored.id,
        sort_order: Number(stored.sort_order),
        type: stored.diff_type,
        risk: stored.risk_level || 'green',
        old_source_text: stored.baseline_text || '',
        new_source_text: stored.compare_text || '',
        old_position: oldPosition,
        new_position: newPosition,
      })
    }

    const statistics = diffs.reduce<ComparisonReportStatistics>((counts, diff) => {
      counts.total += 1
      counts[diff.type] += 1
      counts[diff.risk] += 1
      return counts
    }, { total: 0, added: 0, deleted: 0, modified: 0, moved: 0, red: 0, yellow: 0, green: 0 })

    try {
      const report = await generateComparisonReportDocx({
        comparison_id: comparison.id,
        completed_at: comparison.completed_at,
        old_snapshot: {
          snapshot_id: oldSource.id,
          file_name: oldSource.file_name,
          storage_path: oldSource.storage_path,
          file_sha256: oldSource.file_sha256,
          text_sha256: oldSource.text_sha256,
          captured_at: oldSource.captured_at,
          immutable_at_creation: true,
        },
        new_snapshot: {
          snapshot_id: newSource.id,
          file_name: newSource.file_name,
          storage_path: newSource.storage_path,
          file_sha256: newSource.file_sha256,
          text_sha256: newSource.text_sha256,
          captured_at: newSource.captured_at,
          immutable_at_creation: true,
        },
        statistics,
        diffs,
      })
      return new NextResponse(Uint8Array.from(report.buffer), {
        headers: {
          'Content-Type': report.mimeType,
          'Content-Length': String(report.buffer.byteLength),
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(report.filename)}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Comparison-Id': comparison.id,
          'X-Old-Source-Hash': oldSource.file_sha256,
          'X-New-Source-Hash': newSource.file_sha256,
        },
      })
    } catch (error) {
      if (error instanceof ComparisonReportValidationError) {
        return errorResponse(createApiError('CONFLICT', `报告证据不完整：${error.message}`), 409)
      }
      return errorResponse(createApiError('INTERNAL_ERROR', '差异报告生成失败'))
    }
  })
}
