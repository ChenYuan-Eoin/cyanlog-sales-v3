import { NextRequest, NextResponse } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth'
import { DashboardDataError, getPersonalDashboardData } from '@/lib/dashboard-data'
import { DepartmentAccessError, getPersonalDashboardOrg } from './department/data'

export const preferredRegion = 'sin1'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const params = req.nextUrl.searchParams
    const view = params.get('view')
    if (params.has('spaceId')) {
      return NextResponse.json({ error: '请按部门选择数据范围', code: 'DEPARTMENT_SELECTION_REQUIRED' }, { status: 400, headers: NO_STORE })
    }
    if (params.getAll('view').length > 1 || (view !== null && view !== 'personal')) {
      return NextResponse.json({ error: '工作台请求无效', code: 'INVALID_SELECTION' }, { status: 400, headers: NO_STORE })
    }

    const organizationId = await getPersonalDashboardOrg(user.id)
    const personal = await getPersonalDashboardData(user.id, organizationId)
    return NextResponse.json({
      spaces: [], activeSpace: null, opportunities: [], milestones: [], ...personal, organizationId,
    }, { headers: NO_STORE })
  } catch (error) {
    let status = 500
    let code = 'INTERNAL_ERROR'
    let message = '暂时无法加载工作台'
    if (error instanceof DashboardDataError || error instanceof DepartmentAccessError) {
      status = error instanceof DashboardDataError ? error.status : 403
      code = error.code
      message = error.message
    } else if (error instanceof AuthError) {
      status = 401
      code = 'UNAUTHORIZED'
      message = '未登录或登录已过期'
    }
    return NextResponse.json({ error: message, code }, { status, headers: NO_STORE })
  }
}
