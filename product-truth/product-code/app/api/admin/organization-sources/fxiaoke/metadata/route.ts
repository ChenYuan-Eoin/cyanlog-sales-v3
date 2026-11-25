// REQ: F054 / WP97. Organization managers may inspect read-only Fxiaoke schema
// needed to configure the CRM shipping bridge. This endpoint never activates a
// source, synchronizes a directory, or writes provider data.
import { NextRequest, NextResponse } from 'next/server'
import { loadOrganizationSourceAccess } from '@/lib/admin/organization-source-access'
import { inspectObjectMetadata } from '@/lib/fxiaoke/client'
import { FxiaokeError } from '@/lib/fxiaoke/contracts'
import { directoryTransportForOrganization } from '@/lib/fxiaoke/egress/directory-transport'
import { loadSavedCredentialsForMetadataInspection } from '@/lib/fxiaoke/settings'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    const context = await loadOrganizationSourceAccess(req)
    if (!context?.canInspectCrmMetadata) {
      return NextResponse.json({ error: '无权检查此企业的纷享对象元数据。' }, { status: 403 })
    }
    const { orgId } = context

    const operation = req.nextUrl.searchParams.get('operation') || 'list'
    if (operation !== 'list' && operation !== 'describe') {
      throw new FxiaokeError('INVALID_ACTION', '只支持读取对象目录或单个对象描述。', 400)
    }
    const objectApiName = req.nextUrl.searchParams.get('objectApiName')?.trim() || ''
    if (operation === 'describe' && !/^[A-Za-z][A-Za-z0-9_]*$/.test(objectApiName)) {
      throw new FxiaokeError('INVALID_INPUT', '请提供有效的业务对象 API 名称。', 400)
    }

    const credentials = await loadSavedCredentialsForMetadataInspection(orgId)
    const result = await inspectObjectMetadata(
      credentials,
      operation === 'list' ? { operation } : { operation, objectApiName },
      directoryTransportForOrganization(orgId),
    )
    return NextResponse.json({ data: result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return NextResponse.json({ error: '请先登录。' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
    }
    if (error instanceof FxiaokeError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    return NextResponse.json(
      { error: '纷享对象元数据暂不可用。', code: 'METADATA_INSPECTION_FAILED' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
