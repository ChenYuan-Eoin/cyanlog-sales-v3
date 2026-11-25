import { NextRequest, NextResponse } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth'
import { DashboardDataError, getPersonalDashboardData, getVerifiedLegacyDashboardPayload } from '@/lib/dashboard-data'
import { DepartmentAccessError, getDepartmentLegacyWorkspace, getPersonalDashboardOrg } from './department/data'

export const preferredRegion = 'sin1'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const params = req.nextUrl.searchParams
    const requestedSpaceId = params.get('spaceId')
    const view = params.get('view')
    if (params.getAll('spaceId').length > 1 || params.getAll('view').length > 1 || requestedSpaceId === ''
      || (view !== null && (view !== 'personal' || requestedSpaceId !== null))) {
      return NextResponse.json({ error: '工作台请求无效', code: 'INVALID_SELECTION' }, { status: 400, headers: NO_STORE })
    }

    if (view === 'personal') {
      const orgId = await getPersonalDashboardOrg(user.id)
      const personal = await getPersonalDashboardData(user.id, orgId)
      return NextResponse.json({
        spaces: [], activeSpace: null, opportunities: [], milestones: [], ...personal,
      }, { headers: NO_STORE })
    }

    try {
      const { orgId, ...workspace } = await getDepartmentLegacyWorkspace(user.id, requestedSpaceId)
      return NextResponse.json({ ...workspace, ...await getPersonalDashboardData(user.id, orgId) }, { headers: NO_STORE })
    } catch (error) {
      if (!(error instanceof DepartmentAccessError) || error.code !== 'DEPARTMENT_SCOPE_REQUIRED' || !error.orgId) throw error
      const payload = await getVerifiedLegacyDashboardPayload(user, error.orgId, requestedSpaceId)
      return NextResponse.json(payload, { headers: NO_STORE })
    }
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
