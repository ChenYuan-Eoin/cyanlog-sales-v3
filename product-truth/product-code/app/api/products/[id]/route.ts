import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { validatePriceTiers } from '@/lib/pricing/engine'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'
import { isSchemaDriftError } from '@/lib/db-compat'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

function migrationRequiredResponse(message: string = '当前数据库尚未升级阶梯价结构，请先执行 migration') {
  return errorResponse(message, 409, 'MIGRATION_REQUIRED')
}

const tierSchema = z.object({
  id: z.string().uuid().optional(),
  qty_from: z.number().int().min(1),
  qty_to: z.number().int().min(2).nullable().optional(),
  unit_price: z.number().nonnegative(),
  sort_order: z.number().int().min(0).optional().default(0),
})

const productUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  code: z.string().min(1).max(50).optional(),
  category_id: z.string().uuid().nullable().optional(),
  specification: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  base_price: z.number().nonnegative().optional(),
  cost_price: z.number().nonnegative().nullable().optional(),
  min_price: z.number().nonnegative().optional(),
  tier_pricing_enabled: z.boolean().optional(),
  status: z.enum(['active', 'inactive', 'discontinued']).optional(),
  tiers: z.array(tierSchema).optional(),
})

async function replaceProductTiers(productId: string, tiers: Array<z.infer<typeof tierSchema>>) {
  const { error: deleteError } = await supabaseAdmin
    .from('product_price_tiers')
    .delete()
    .eq('product_id', productId)

  if (deleteError) {
    throw deleteError
  }

  if (tiers.length === 0) {
    return
  }

  const { error: insertError } = await supabaseAdmin
    .from('product_price_tiers')
    .insert(tiers.map((tier, index) => ({
      id: tier.id || uuidv4(),
      product_id: productId,
      qty_from: tier.qty_from,
      qty_to: tier.qty_to ?? null,
      unit_price: tier.unit_price,
      sort_order: tier.sort_order ?? index,
    })))

  if (insertError) {
    throw insertError
  }
}

export async function GET(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const id = await resolveIdParam(params)

    const result = await supabaseAdmin
      .from('products')
      .select('*, product_categories(name), product_price_tiers(*)')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    let productData = result.data
    let productError = result.error

    if (productError && isSchemaDriftError(productError)) {
      const legacyResult = await supabaseAdmin
        .from('products')
        .select('*, product_categories(name)')
        .eq('id', id)
        .single()

      productData = legacyResult.data ? {
          ...legacyResult.data,
          tier_pricing_enabled: false,
          product_price_tiers: [],
          _migration_required: true,
        } : null
      productError = legacyResult.error
    }

    if (productError || !productData) {
      return errorResponse('SKU 不存在', 404, 'NOT_FOUND')
    }

    return NextResponse.json(productData)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Get product error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

export async function PUT(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const user = await requireAuth(req)
    const id = await resolveIdParam(params)
    const body = await req.json().catch(() => null)
    const validated = productUpdateSchema.safeParse(body)

    if (!validated.success) {
      return errorResponse('产品数据无效', 400, 'INVALID_DATA')
    }

    const orgId = await getDefaultOrgId(user.id)

    let schemaDriftDetected = false
    const fetchResult = await supabaseAdmin
      .from('products')
      .select('id, min_price, tier_pricing_enabled')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    let existing = fetchResult.data as {
      id: string
      min_price: number | null
      tier_pricing_enabled: boolean
    } | null
    let fetchError = fetchResult.error

    if (fetchError && isSchemaDriftError(fetchError)) {
      schemaDriftDetected = true
      const legacyResult = await supabaseAdmin
        .from('products')
        .select('id, min_price')
        .eq('id', id)
        .single()

      existing = legacyResult.data ? {
          ...legacyResult.data,
          tier_pricing_enabled: false,
        } : null
      fetchError = legacyResult.error
    }

    if (fetchError || !existing) {
      return errorResponse('SKU 不存在', 404, 'NOT_FOUND')
    }

    const nextMinPrice = validated.data.min_price ?? existing.min_price ?? 0
    const nextTiers = validated.data.tiers?.map((tier, index) => ({
      ...tier,
      qty_to: tier.qty_to ?? null,
      sort_order: tier.sort_order ?? index,
    }))

    if (schemaDriftDetected && (validated.data.tier_pricing_enabled || (nextTiers && nextTiers.length > 0))) {
      return migrationRequiredResponse()
    }

    if (nextTiers) {
      const tierError = validatePriceTiers(nextTiers, nextMinPrice)
      if (tierError) {
        return errorResponse(tierError, 400, 'INVALID_TIERS')
      }
    }

    const { tiers: _ignoredTiers, ...updatePayload } = {
      ...validated.data,
      tier_pricing_enabled: validated.data.tier_pricing_enabled ?? (nextTiers ? nextTiers.length > 0 : existing.tier_pricing_enabled),
      updated_at: new Date().toISOString(),
    }

    let updateResult = await supabaseAdmin
      .from('products')
      .update(updatePayload)
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single()

    if (updateResult.error && isSchemaDriftError(updateResult.error)) {
      if (nextTiers || validated.data.tier_pricing_enabled) {
        return migrationRequiredResponse()
      }

      updateResult = await supabaseAdmin
        .from('products')
        .update({
          name: validated.data.name,
          code: validated.data.code,
          category_id: validated.data.category_id,
          specification: validated.data.specification,
          unit: validated.data.unit,
          base_price: validated.data.base_price,
          cost_price: validated.data.cost_price,
          min_price: validated.data.min_price,
          status: validated.data.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single()
    }

    if (updateResult.error) {
      console.error('Update product error:', updateResult.error)
      return errorResponse('更新 SKU 失败', 500, 'DB_ERROR')
    }

    if (nextTiers) {
      await replaceProductTiers(id, nextTiers)
    }

    const fullProductResult = await supabaseAdmin
      .from('products')
      .select('*, product_categories(name), product_price_tiers(*)')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    let fullProductData = fullProductResult.data
    let fullProductError = fullProductResult.error

    if (fullProductError && isSchemaDriftError(fullProductError)) {
      const legacyResult = await supabaseAdmin
        .from('products')
        .select('*, product_categories(name)')
        .eq('id', id)
        .single()

      fullProductData = legacyResult.data ? {
          ...legacyResult.data,
          tier_pricing_enabled: false,
          product_price_tiers: [],
          _migration_required: true,
        } : null
      fullProductError = legacyResult.error
    }

    if (fullProductError) {
      return NextResponse.json(updateResult.data)
    }

    return NextResponse.json(fullProductData || updateResult.data)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Update product error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

export async function DELETE(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const id = await resolveIdParam(params)

    let result = await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId)

    if (result.error && isSchemaDriftError(result.error)) {
      result = await supabaseAdmin
        .from('products')
        .delete()
        .eq('id', id)
    }

    if (result.error) {
      console.error('Delete product error:', result.error)
      return errorResponse('删除 SKU 失败', 500, 'DB_ERROR')
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Delete product error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
