import { NextRequest,NextResponse } from 'next/server'
import { resolvePublicShippingOrgId } from '@/lib/shipping/runtime-config'
import { readWecomSettings } from '@/lib/shipping/wecom-settings'
import { createWecomState,WECOM_STATE_COOKIE } from '@/lib/shipping/wecom-session'
export const runtime='nodejs'
export async function GET(req:NextRequest){
 try {
  const orgId=await resolvePublicShippingOrgId(),config=await readWecomSettings(orgId)
  if(!config?.directory_synced_at)return NextResponse.redirect(new URL('/sales-portal?access=setup',req.url))
  // Only the two existing project domains may receive a code. The quote domain
  // already canonicalizes to sales while retaining the public callback path.
  const domain=config.redirect_domain
  if(!['quote.cyanlog.icu','sales.cyanlog.icu'].includes(domain))return NextResponse.redirect(new URL('/sales-portal?access=domain',req.url))
  const callback=`https://${domain}/api/shipping/public/wecom/callback`,state=createWecomState(orgId)
  const embedded=/MicroMessenger/i.test(req.headers.get('user-agent')||'')
  const url=new URL(embedded?'https://open.weixin.qq.com/connect/oauth2/authorize':'https://open.work.weixin.qq.com/wwopen/sso/qrConnect')
  url.searchParams.set('appid',config.corp_id);url.searchParams.set('agentid',String(config.agent_id));url.searchParams.set('redirect_uri',callback);url.searchParams.set('state',state)
  if(embedded){url.searchParams.set('response_type','code');url.searchParams.set('scope','snsapi_base');url.hash='wechat_redirect'}
  const response=NextResponse.redirect(url)
  response.cookies.set(WECOM_STATE_COOKIE,state,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:600});response.headers.set('Cache-Control','no-store');return response
 }catch{return NextResponse.redirect(new URL('/sales-portal?access=unavailable',req.url))}
}
