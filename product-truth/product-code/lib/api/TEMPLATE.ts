// API 路由规范化迁移指南
// 所有新路由都应遵循此规范
//
// 使用方法：复制本文档中的模板代码到你的路由文件中

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _DOC_VERSION = '1.0.0'

// ============================================================
// 1. 基础模板 - 简单 CRUD
// ============================================================

/*
import { NextRequest } from 'next/server'
import {
  errorResponse,
  paginatedResponse,
  createdResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'

// GET /api/resources - 列表（分页）
export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    // 解析查询参数
    const { searchParams } = new URL(req.url)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    // 查询数据库
    const { data, error, count } = await supabaseAdmin
      .from('resources')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .range(offset, offset + limit - 1)

    if (error) {
      return errorResponse(createApiError('DB_ERROR'))
    }

    // 返回分页响应
    return paginatedResponse(data || [], count || 0, limit, offset)
  })
}

// POST /api/resources - 创建
export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const body = await req.json()

    // 验证输入（使用 Zod）
    const result = resourceSchema.safeParse(body)
    if (!result.success) {
      return errorResponse(
        createApiError(
          'VALIDATION_ERROR',
          result.error.issues[0].message
        )
      )
    }

    // 创建资源
    const { data, error } = await supabaseAdmin
      .from('resources')
      .insert({
        ...result.data,
        org_id: orgId,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return errorResponse(createApiError('DUPLICATE_KEY'))
      }
      return errorResponse(createApiError('DB_ERROR'))
    }

    return createdResponse(data)
  })
}
*/

// ============================================================
// 2. 单资源操作（带ID路由）
// ============================================================

/*
// app/api/resources/[id]/route.ts
import { NextRequest } from 'next/server'
import {
  successResponse,
  errorResponse,
  noContentResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'

// GET - 获取单个资源
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { data, error } = await supabaseAdmin
      .from('resources')
      .select('*')
      .eq('id', params.id)
      .eq('org_id', orgId)
      .single()

    if (error || !data) {
      return errorResponse(createApiError('NOT_FOUND'))
    }

    return successResponse(data)
  })
}

// PATCH - 更新资源
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const body = await req.json()

    const { data, error } = await supabaseAdmin
      .from('resources')
      .update(body)
      .eq('id', params.id)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) {
      return errorResponse(createApiError('DB_ERROR'))
    }

    return successResponse(data)
  })
}

// DELETE - 删除资源
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { error } = await supabaseAdmin
      .from('resources')
      .delete()
      .eq('id', params.id)
      .eq('org_id', orgId)

    if (error) {
      return errorResponse(createApiError('DB_ERROR'))
    }

    return noContentResponse()
  })
}
*/

// ============================================================
// 3. 常见错误码选择指南
// ============================================================

/*
| 场景 | 错误码 | HTTP状态 |
|------|--------|----------|
| 未登录 | UNAUTHORIZED (A001) | 401 |
| 无权限 | FORBIDDEN (A002) | 403 |
| 参数验证失败 | VALIDATION_ERROR (V001) | 400 |
| 资源不存在 | NOT_FOUND (R001) | 404 |
| 资源已存在 | DUPLICATE_KEY (R002) | 409 |
| 未选择组织 | NO_ORG (O001) | 400 |
| 数据库错误 | DB_ERROR (S001) | 500 |
| 业务规则冲突 | BUSINESS_RULE_VIOLATION (B001) | 400 |
*/

// ============================================================
// 4. 最佳实践
// ============================================================

/*
1. 始终使用包装器
   - withAuthAndOrg: 需要认证+组织上下文

2. 响应格式统一
   成功: { success: true, data: T, meta?: {} }
   错误: { success: false, error: { code, message, details? } }

3. 错误处理顺序
   - 先验证输入（Zod）
   - 再检查权限/组织
   - 最后数据库操作
   - 每个步骤都要有错误处理

4. 不要使用
   - ❌ 自定义 errorResponse
   - ❌ 手动处理 try/catch 认证
   - ❌ 不同的响应格式
   - ❌ 硬编码错误消息
*/

// 必须导出一些东西以避免 TypeScript 报错
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const API_TEMPLATE_VERSION = '1.0.0'
