import type { NextRequest } from 'next/server'
import { handleSuperAdminAssignment } from '@/lib/admin/super-admin-assignments'
import type { AsyncRouteParams } from '@/lib/route-params'

export async function GET(req: NextRequest, { params }: AsyncRouteParams) {
  return handleSuperAdminAssignment(req, (await params).id, 'system')
}

export async function PATCH(req: NextRequest, { params }: AsyncRouteParams) {
  return handleSuperAdminAssignment(req, (await params).id, 'system')
}
