// F003 / WP94. Public provider discovery is read-only and never exposes tenant IDs.
import { NextResponse } from 'next/server'
import { isLocalAccountLoginEnabled } from '@/lib/auth/local-account-config'
import { listConfiguredOAuthOrganizationIds, resolveConfiguredOAuthOrganization } from '@/lib/fxiaoke/sso'
import { listVerifiedConnectionOrganizationIds } from '@/lib/organization-connections'

export const runtime = 'nodejs'

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' }
  const localAccountEnabled = isLocalAccountLoginEnabled()
  try {
    const organizationIds = await listConfiguredOAuthOrganizationIds()
    if (organizationIds.length === 0) {
      const verifiedIds = await listVerifiedConnectionOrganizationIds('fxiaoke', 1)
      return NextResponse.json({
        providers: [], localAccountEnabled,
        providerStatus: verifiedIds.length > 0 ? 'paused' : 'not_configured',
      }, { headers })
    }
    if (organizationIds.length > 1) {
      return NextResponse.json(
        { providers: [], localAccountEnabled, providerStatus: 'configuration_error', error: '检测到多个企业登录配置，管理员处理后才能登录。' },
        { status: 503, headers },
      )
    }
    await resolveConfiguredOAuthOrganization()
    return NextResponse.json({
      localAccountEnabled,
      providers: [{ id: 'fxiaoke', label: '纷享销客', startUrl: '/api/auth/fxiaoke/start' }],
    }, { headers })
  } catch {
    return NextResponse.json(
      { providers: [], localAccountEnabled, providerStatus: 'unavailable', error: '企业统一登录暂时不可用，请联系管理员。' },
      { status: 503, headers },
    )
  }
}
