import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { validatePriceTiers } from '@/lib/pricing/engine'
import { isSchemaDriftError } from '@/lib/db-compat'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

function migrationRequiredResponse(message: string = '当前数据库尚未升级阶梯价结构，请先执行 migration') {
  return errorResponse(message, 409, 'MIGRATION_REQUIRED')
}

const tierSchema = z.object({
  id: z.string().uuid().optional(),
  product_id: z.string().uuid(),
  qty_from: z.number().int().min(1),
  qty_to: z.number().int().min(2).nullable().optional(),
  unit_price: z.number().nonnegative(),
  sort_order: z.number().int().min(0).optional().default(0),
})

const tierUpdateSchema = tierSchema.partial().extend({
  id: z.string().uuid(),
  product_id: z.string().uuid().optional(),
})

async function verifyProductAccess(productId: string, orgId: string) {
  const result = await supabaseAdmin
    .from('products')
    .select('id, min_price')
    .eq('id', productId)
    .eq('org_id', orgId)
    .single()

  if (result.error && isSchemaDriftError(result.error)) {
    const legacyResult = await supabaseAdmin
      .from('products')
      .select('id, min_price')
      .eq('id', productId)
      .single()

    return {
      data: legacyResult.data,
      error: legacyResult.error,
      migrationRequired: true,
    }
  }

  return {
    data: result.data,
    error: result.error,
    migrationRequired: false,
  }
}

async function loadTiers(productId: string) {
  const result = await supabaseAdmin
    .from('product_price_tiers')
    .select('*')
    .eq('product_id', productId)
    .order('sort_order')

  if (result.error) {
    if (isSchemaDriftError(result.error)) {
      return { data: [], migrationRequired: true }
    }
    throw result.error
  }

  return {
    data: result.data || [],
    migrationRequired: false,
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { searchParams } = new URL(req.url)
    const productId = searchParams.get('product_id')

    if (!productId) {
      return errorResponse('缺少 product_id', 400, 'INVALID_DATA')
    }

    const productLookup = await verifyProductAccess(productId, orgId)
    if (productLookup.error || !productLookup.data) {
      return errorResponse('SKU 不存在或无权限', 404, 'NOT_FOUND')
    }
    if (productLookup.migrationRequired) {
      return migrationRequiredResponse()
    }

    const tiersResult = await loadTiers(productId)
    if (tiersResult.migrationRequired) {
      return migrationRequiredResponse()
    }

    return NextResponse.json(tiersResult.data)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Get price tiers error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const body = await req.json()
    const validated = tierSchema.safeParse(body)

    if (!validated.success) {
      return errorResponse('阶梯价数据无效', 400, 'INVALID_DATA')
    }

    const productLookup = await verifyProductAccess(validated.data.product_id, orgId)
    if (productLookup.error || !productLookup.data) {
      return errorResponse('SKU 不存在或无权限', 404, 'NOT_FOUND')
    }
    if (productLookup.migrationRequired) {
      return migrationRequiredResponse()
    }

    const tiersResult = await loadTiers(validated.data.product_id)
    if (tiersResult.migrationRequired) {
      return migrationRequiredResponse()
    }

    const nextTiers = [...tiersResult.data, validated.data]
    const tierError = validatePriceTiers(nextTiers, productLookup.data.min_price || 0)
    if (tierError) {
      return errorResponse(tierError, 400, 'INVALID_TIERS')
    }

    const { data, error } = await supabaseAdmin
      .from('product_price_tiers')
      .insert({
        id: validated.data.id || uuidv4(),
        product_id: validated.data.product_id,
        qty_from: validated.data.qty_from,
        qty_to: validated.data.qty_to ?? null,
        unit_price: validated.data.unit_price,
        sort_order: validated.data.sort_order ?? tiersResult.data.length,
      })
      .select()
      .single()

    if (error) {
      if (isSchemaDriftError(error)) {
        return migrationRequiredResponse()
      }
      console.error('Create price tier error:', error)
      return errorResponse('创建阶梯价失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Create price tier error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const body = await req.json()
    const validated = tierUpdateSchema.safeParse(body)

    if (!validated.success || !validated.data.id) {
      return errorResponse('阶梯价数据无效', 400, 'INVALID_DATA')
    }

    const tierResult = await supabaseAdmin
      .from('product_price_tiers')
      .select('*')
      .eq('id', validated.data.id)
      .single()

    if (tierResult.error) {
      if (isSchemaDriftError(tierResult.error)) {
        return migrationRequiredResponse()
      }
      return errorResponse('阶梯价不存在', 404, 'NOT_FOUND')
    }

    const existingTier = tierResult.data
    if (!existingTier) {
      return errorResponse('阶梯价不存在', 404, 'NOT_FOUND')
    }

    const productId = validated.data.product_id || existingTier.product_id
    const productLookup = await verifyProductAccess(productId, orgId)
    if (productLookup.error || !productLookup.data) {
      return errorResponse('SKU 不存在或无权限', 404, 'NOT_FOUND')
    }
    if (productLookup.migrationRequired) {
      return migrationRequiredResponse()
    }

    const tiersResult = await loadTiers(productId)
    if (tiersResult.migrationRequired) {
      return migrationRequiredResponse()
    }

    const nextTiers = tiersResult.data.map((tier) => (
      tier.id === validated.data.id
        ? { ...tier, ...validated.data, product_id: productId }
        : tier
    ))
    const validationError = validatePriceTiers(nextTiers, productLookup.data.min_price || 0)
    if (validationError) {
      return errorResponse(validationError, 400, 'INVALID_TIERS')
    }

    const { data, error } = await supabaseAdmin
      .from('product_price_tiers')
      .update({
        product_id: productId,
        qty_from: validated.data.qty_from ?? existingTier.qty_from,
        qty_to: validated.data.qty_to ?? existingTier.qty_to,
        unit_price: validated.data.unit_price ?? existingTier.unit_price,
        sort_order: validated.data.sort_order ?? existingTier.sort_order,
        updated_at: new Date().toISOString(),
      })
      .eq('id', validated.data.id)
      .select()
      .single()

    if (error) {
      if (isSchemaDriftError(error)) {
        return migrationRequiredResponse()
      }
      console.error('Update price tier error:', error)
      return errorResponse('更新阶梯价失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(data)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Update price tier error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return errorResponse('缺少 id', 400, 'INVALID_DATA')
    }

    const tierResult = await supabaseAdmin
      .from('product_price_tiers')
      .select('id, product_id')
      .eq('id', id)
      .single()

    if (tierResult.error) {
      if (isSchemaDriftError(tierResult.error)) {
        return migrationRequiredResponse()
      }
      return errorResponse('阶梯价不存在', 404, 'NOT_FOUND')
    }

    const existingTier = tierResult.data
    if (!existingTier) {
      return errorResponse('阶梯价不存在', 404, 'NOT_FOUND')
    }

    const productLookup = await verifyProductAccess(existingTier.product_id, orgId)
    if (productLookup.error || !productLookup.data) {
      return errorResponse('SKU 不存在或无权限', 404, 'NOT_FOUND')
    }
    if (productLookup.migrationRequired) {
      return migrationRequiredResponse()
    }

    const { error } = await supabaseAdmin
      .from('product_price_tiers')
      .delete()
      .eq('id', id)

    if (error) {
      if (isSchemaDriftError(error)) {
        return migrationRequiredResponse()
      }
      console.error('Delete price tier error:', error)
      return errorResponse('删除阶梯价失败', 500, 'DB_ERROR')
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Delete price tier error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
