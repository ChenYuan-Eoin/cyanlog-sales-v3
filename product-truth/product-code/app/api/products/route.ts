// REQ:F001
// PURPOSE: Product / SKU API - org scoped list and create

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
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
  qty_from: z.number().int().min(1),
  qty_to: z.number().int().min(2).nullable().optional(),
  unit_price: z.number().nonnegative(),
  sort_order: z.number().int().min(0).optional().default(0),
})

const productSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  category_id: z.string().uuid().optional().nullable(),
  specification: z.string().optional(),
  unit: z.string().optional(),
  base_price: z.number().nonnegative().default(0),
  cost_price: z.number().nonnegative().optional(),
  min_price: z.number().nonnegative().optional().default(0),
  tier_pricing_enabled: z.boolean().optional().default(false),
  status: z.enum(['active', 'inactive', 'discontinued']).default('active'),
  tiers: z.array(tierSchema).optional().default([]),
})

async function parseProductPayload(req: NextRequest) {
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return req.json()
  }

  const formData = await req.formData()
  return {
    name: String(formData.get('name') || ''),
    code: String(formData.get('code') || ''),
    category_id: String(formData.get('category_id') || '') || undefined,
    specification: String(formData.get('specification') || '') || undefined,
    unit: String(formData.get('unit') || '') || undefined,
    base_price: Number(formData.get('base_price') || 0),
    cost_price: formData.get('cost_price') ? Number(formData.get('cost_price')) : undefined,
    min_price: formData.get('min_price') ? Number(formData.get('min_price')) : undefined,
    status: String(formData.get('status') || 'active'),
    tier_pricing_enabled: false,
    tiers: [],
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)

    const { searchParams } = new URL(req.url)
    const categoryId = searchParams.get('category_id')
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    // 分页参数，默认 50 条，最大 100 条
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    // 主查询：只查产品基本信息（不含阶梯价，避免笛卡尔积）
    let query = supabaseAdmin
      .from('products')
      .select('*, product_categories(name)', { count: 'exact' })
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (categoryId) {
      query = query.eq('category_id', categoryId)
    }

    if (status) {
      query = query.eq('status', status)
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`)
    }

    let { data, error, count } = await query

    if (error && isSchemaDriftError(error)) {
      let legacyQuery = supabaseAdmin
        .from('products')
        .select('*, product_categories(name)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (categoryId) {
        legacyQuery = legacyQuery.eq('category_id', categoryId)
      }
      if (status) {
        legacyQuery = legacyQuery.eq('status', status)
      }
      if (search) {
        legacyQuery = legacyQuery.or(`name.ilike.%${search}%,code.ilike.%${search}%`)
      }

      const legacyResult = await legacyQuery
      data = (legacyResult.data || []).map((product) => ({
        ...product,
        tier_pricing_enabled: false,
        product_price_tiers: [],
        _migration_required: true,
      }))
      error = legacyResult.error
      count = legacyResult.count
    }

    if (error) {
      console.error('Get products error:', error)
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    // 返回分页数据
    return NextResponse.json({
      data,
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (count || 0) > offset + limit,
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Get products error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const body = await parseProductPayload(req)
    const validated = productSchema.safeParse(body)

    if (!validated.success) {
      return errorResponse('产品数据无效', 400, 'INVALID_DATA')
    }

    const normalizedTiers = validated.data.tiers.map((tier, index) => ({
      ...tier,
      qty_to: tier.qty_to ?? null,
      sort_order: tier.sort_order ?? index,
    }))

    const tierError = validatePriceTiers(normalizedTiers, validated.data.min_price || 0)
    if (tierError) {
      return errorResponse(tierError, 400, 'INVALID_TIERS')
    }

    const productId = uuidv4()
    let insertResult = await supabaseAdmin
      .from('products')
      .insert({
        id: productId,
        org_id: orgId,
        name: validated.data.name,
        code: validated.data.code,
        category_id: validated.data.category_id || null,
        specification: validated.data.specification,
        unit: validated.data.unit,
        base_price: validated.data.base_price,
        cost_price: validated.data.cost_price,
        min_price: validated.data.min_price,
        tier_pricing_enabled: validated.data.tier_pricing_enabled || normalizedTiers.length > 0,
        status: validated.data.status,
        created_by: user.id,
      })
      .select()
      .single()

    if (insertResult.error && isSchemaDriftError(insertResult.error)) {
      if (validated.data.tier_pricing_enabled || normalizedTiers.length > 0) {
        return migrationRequiredResponse()
      }

      insertResult = await supabaseAdmin
        .from('products')
        .insert({
          id: productId,
          name: validated.data.name,
          code: validated.data.code,
          category_id: validated.data.category_id || null,
          specification: validated.data.specification,
          unit: validated.data.unit,
          base_price: validated.data.base_price,
          cost_price: validated.data.cost_price,
          min_price: validated.data.min_price,
          status: validated.data.status,
          created_by: user.id,
        })
        .select()
        .single()
    }

    if (insertResult.error) {
      console.error('Create product error:', insertResult.error)
      return errorResponse('创建产品失败', 500, 'DB_ERROR')
    }

    const product = insertResult.data

    if (normalizedTiers.length > 0) {
      const { error: tierInsertError } = await supabaseAdmin
        .from('product_price_tiers')
        .insert(normalizedTiers.map((tier, index) => ({
          id: tier.id || uuidv4(),
          product_id: productId,
          qty_from: tier.qty_from,
          qty_to: tier.qty_to,
          unit_price: tier.unit_price,
          sort_order: tier.sort_order ?? index,
        })))

      if (tierInsertError) {
        if (isSchemaDriftError(tierInsertError)) {
          return errorResponse('当前数据库尚未升级阶梯价结构，请先执行 migration', 409, 'MIGRATION_REQUIRED')
        }
        await supabaseAdmin.from('products').delete().eq('id', productId)
        console.error('Create product tiers error:', tierInsertError)
        return errorResponse('创建阶梯价失败', 500, 'DB_ERROR')
      }
    }

    const fullProductResult = await supabaseAdmin
      .from('products')
      .select('*, product_categories(name), product_price_tiers(*)')
      .eq('id', product.id)
      .eq('org_id', orgId)
      .single()

    let fullProductData = fullProductResult.data
    let fullProductError = fullProductResult.error

    if (fullProductError && isSchemaDriftError(fullProductError)) {
      const legacyResult = await supabaseAdmin
        .from('products')
        .select('*, product_categories(name)')
        .eq('id', product.id)
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
      return NextResponse.json(product, { status: 201 })
    }

    return NextResponse.json(fullProductData || product, { status: 201 })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Create product error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
