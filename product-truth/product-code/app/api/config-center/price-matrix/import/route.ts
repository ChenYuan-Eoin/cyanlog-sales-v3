// REQ: F028
// PURPOSE: 多维价盘导入预览（只校验不落库；阶段 0 硬门：234 行 0 失败）
import { NextRequest } from 'next/server'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { priceMatrixRowSchema } from '@/lib/config-center/validation'
import { validatePriceRows } from '@/lib/config-center/price-import'

const importSchema = z.object({
  rows: z.array(priceMatrixRowSchema).min(1, '至少一行'),
  commit: z.boolean().default(false),
})

export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (user, orgId) => {
    try {
      const body = await req.json()
      const parsed = importSchema.safeParse(body)
      if (!parsed.success) {
        return errorResponse(createApiError('VALIDATION_ERROR', `导入数据无效: ${parsed.error.issues.map((e) => e.message).join('; ')}`))
      }
      const rows = parsed.data.rows as Parameters<typeof validatePriceRows>[0]
      const result = validatePriceRows(rows)
      if (!result.ok) {
        return successResponse({
          ok: false,
          checked: result.checked,
          issue_count: result.issues.length,
          issues: result.issues.slice(0, 200),
          message: '校验失败，拒绝发布',
        })
      }
      if (!parsed.data.commit) {
        return successResponse({
          ok: true,
          checked: result.checked,
          issue_count: 0,
          issues: [],
          message: `校验通过（${result.checked} 组累计关系），可发布`,
        })
      }
      // 落库（DRAFT，version=1）
      const { data: inserted, error } = await supabaseAdmin
        .from('price_matrix')
        .insert(
          rows.map((row) => ({
            org_id: orgId,
            product_id: row.product_id,
            version_code: row.version_code,
            deployment: row.deployment,
            auth_mode: row.auth_mode,
            term_months: row.term_months ?? null,
            currency: row.currency ?? 'CNY',
            qty_from: row.qty_from,
            qty_to: row.qty_to ?? null,
            unit_price: row.unit_price ?? null,
            list_price: row.list_price ?? null,
            sort_order: row.sort_order ?? 0,
            status: 'DRAFT',
            version: 1,
            created_by: user.id,
          }))
        )
        .select('id')
      if (error) {
        return errorResponse(createApiError('DB_ERROR', error.message))
      }
      return successResponse({
        ok: true,
        checked: result.checked,
        issue_count: 0,
        inserted: inserted?.length ?? 0,
        message: `校验通过并落库 ${inserted?.length ?? 0} 行（DRAFT）`,
      })
    } catch (err) {
      return errorResponse(createApiError('DB_ERROR', err instanceof Error ? err.message : undefined))
    }
  })
}
