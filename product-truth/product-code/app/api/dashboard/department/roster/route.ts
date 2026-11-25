import { type NextRequest, NextResponse } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth'
import { resolveDepartmentSpaceIds } from '@/lib/department-spaces'
import { readDirectoryRosterSource, verifyDirectoryRoster } from '@/lib/organization-directory-roster'
import { supabaseAdmin } from '@/lib/supabase'
import { DepartmentAccessError, getDepartmentDashboardScope } from '../data'

export const preferredRegion = 'sin1'

const PAGE_SIZE = 20
function json(payload: object, status = 200) {
  return NextResponse.json(payload, { status, headers: { 'Cache-Control': 'no-store' } })
}

function unavailable(reason: 'DIRECTORY_UNCONFIRMED' | 'DIRECTORY_UNAVAILABLE' | 'DIRECTORY_CHANGED') {
  return json({ status: 'unavailable', reason })
}

async function rosterResponse(orgId: string, selectedIds: Set<string>, page: number) {
  const source = await readDirectoryRosterSource(orgId)
  if (source.status === 'unavailable') return json(source)
  const directory = await supabaseAdmin.rpc('get_org_admin_directory_payload_v1', { p_org_id: orgId })
  if (directory.error) return unavailable('DIRECTORY_UNAVAILABLE')
  const roster = await verifyDirectoryRoster(orgId, source, directory.data)
  if (roster.status === 'unavailable') return json(roster)

  const members = roster.members.flatMap(member => {
    const departmentIds = member.departmentIds.filter(departmentId => selectedIds.has(departmentId))
    return departmentIds.length > 0 ? [{ ...member, departmentIds }] : []
  })
  const start = (page - 1) * PAGE_SIZE
  return json({
    status: 'ready', asOf: roster.asOf, members: members.slice(start, start + PAGE_SIZE),
    total: members.length, page, pageSize: PAGE_SIZE,
  })
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const params = req.nextUrl.searchParams
    const departmentId = params.get('departmentId')
    const includeSubdepartments = params.get('includeSubdepartments')
    const rawPage = params.get('page')
    const page = rawPage === null ? 1 : Number(rawPage)
    if (departmentId === '' || ['departmentId', 'includeSubdepartments', 'page'].some(key => params.getAll(key).length > 1)
      || (includeSubdepartments !== null && includeSubdepartments !== 'true' && includeSubdepartments !== 'false')
      || (rawPage !== null && !/^[1-9]\d*$/.test(rawPage))
      || !Number.isSafeInteger(page * PAGE_SIZE)) {
      return json({ code: 'INVALID_SELECTION', error: '部门空间或页码无效' }, 400)
    }
    const scope = await getDepartmentDashboardScope(user.id, {
      departmentId,
      includeSubdepartments: departmentId === null || includeSubdepartments !== 'false',
    })
    const { departmentSpaces, selection } = scope
    const roots = departmentSpaces.map(department => department.department_id)
    const selected = resolveDepartmentSpaceIds(departmentSpaces, roots, selection.departmentId
      ? { departmentId: selection.departmentId, includeSubdepartments: selection.includeSubdepartments }
      : undefined)
    if (selection.departmentId && selected.size === 0) throw new DepartmentAccessError(selection.departmentId)
    return await rosterResponse(scope.orgId, selected, page)
  } catch (error) {
    if (error instanceof AuthError) return json({ code: 'UNAUTHORIZED', error: '未登录或登录已过期' }, 401)
    if (error instanceof DepartmentAccessError) return json({ code: error.code, error: error.message }, 403)
    return json({ code: 'INTERNAL_ERROR', error: '暂时无法加载部门成员' }, 500)
  }
}
