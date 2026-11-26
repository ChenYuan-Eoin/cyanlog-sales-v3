import type { NextRequest } from 'next/server'
import type { AsyncRouteParams } from '@/lib/route-params'
import { mutateOrgRoleMetadata } from '../../metadata'

export async function PATCH(req: NextRequest, { params }: AsyncRouteParams) {
  return mutateOrgRoleMetadata(req, 'rename', (await params).id)
}

export async function DELETE(req: NextRequest, { params }: AsyncRouteParams) {
  return mutateOrgRoleMetadata(req, 'archive', (await params).id)
}
