import { NextRequest,NextResponse } from 'next/server'
import { readWecomSettings,wecomCredentials } from '@/lib/shipping/wecom-settings'
import { ShippingError } from '@/lib/shipping/config'
import { wecomIdentity } from '@/lib/shipping/wecom-client'
import { findWecomMember,issueWecomSession,verifyWecomState,WECOM_SESSION_COOKIE,WECOM_STATE_COOKIE,WECOM_SESSION_SECONDS } from '@/lib/shipping/wecom-session'
export const runtime='nodejs'
export async function GET(req:NextRequest){
 let response:NextResponse
 try {
  const {orgId}=verifyWecomState(req.nextUrl.searchParams.get('state')||'',req.cookies.get(WECOM_STATE_COOKIE)?.value)
  const code=req.nextUrl.searchParams.get('code'),config=await readWecomSettings(orgId)
  if(!code||code.length>512||!config?.directory_synced_at)throw new Error('invalid authorization')
  const userId=await wecomIdentity(wecomCredentials(config),code),profile=await findWecomMember(config,userId)
  if(!profile)throw new Error('not whitelisted')
  const token=await issueWecomSession(profile)
  response=NextResponse.redirect(new URL('/sales-portal',req.url))
  response.cookies.set(WECOM_SESSION_COOKIE,token,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:WECOM_SESSION_SECONDS})
 }catch(error){const reason=error instanceof ShippingError&&error.status===409?'profile':error instanceof ShippingError&&error.status>=500?'unavailable':'denied';response=NextResponse.redirect(new URL(`/sales-portal?access=${reason}`,req.url))}
 response.cookies.set(WECOM_STATE_COOKIE,'',{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:0});response.headers.set('Cache-Control','no-store');return response
}
