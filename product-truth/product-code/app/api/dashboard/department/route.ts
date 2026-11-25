import { NextRequest, NextResponse } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth'
import { DepartmentAccessError, getDepartmentDashboard } from './data'

export const preferredRegion = 'sin1'

const NO_STORE = { 'Cache-Control': 'no-store' }

function errorResponse(status: number, code: string, error: string) {
  return NextResponse.json({ error, code }, { status, headers: NO_STORE })
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const params = req.nextUrl.searchParams
    const departmentId = params.get('departmentId')
    const includeSubdepartments = params.get('includeSubdepartments')
    if (departmentId === '' || params.getAll('departmentId').length > 1
      || params.getAll('includeSubdepartments').length > 1
      || (includeSubdepartments !== null && includeSubdepartments !== 'true' && includeSubdepartments !== 'false')) {
      return errorResponse(400, 'INVALID_SELECTION', '部门空间选择无效')
    }

    const data = await getDepartmentDashboard(user.id, {
      departmentId,
      includeSubdepartments: departmentId === null || includeSubdepartments !== 'false',
    })
    return NextResponse.json(data, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(401, 'UNAUTHORIZED', '未登录或登录已过期')
    if (error instanceof DepartmentAccessError) return errorResponse(403, error.code, error.message)
    return errorResponse(500, 'INTERNAL_ERROR', '暂时无法加载部门空间')
  }
}
