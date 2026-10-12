import { headers } from 'next/headers'
import { NextRequest } from 'next/server'
import { redirect } from 'next/navigation'
import { resolvePublicShippingOrgId } from '@/lib/shipping/runtime-config'
import { readWecomSettings } from '@/lib/shipping/wecom-settings'
import { getWecomSession,wecomProfileDto } from '@/lib/shipping/wecom-session'
import { loadPublicIntakeOptions } from '@/lib/shipping/intake-options'
import SalesPortal from './portal'
import styles from './sales-portal.module.css'
export const dynamic='force-dynamic'
export default async function SalesPortalPage({searchParams}: {searchParams:Promise<{access?:string}>}){
 const query=await searchParams
 let settings,profile,options
 try {
  const orgId=await resolvePublicShippingOrgId();settings=await readWecomSettings(orgId)
  const req=new NextRequest('https://sales.cyanlog.icu/sales-portal',{headers:await headers()})
  profile=await getWecomSession(req)
  if(profile&&profile.orgId!==orgId)profile=null
  options=await loadPublicIntakeOptions()
 }catch{return <main className={styles.page}><section className={styles.card}><h1>寄件身份服务暂不可用</h1><p>请稍后重试，或联系管理员检查名单和寄件联系电话。</p></section></main>}
 if(settings?.order_check_mode!==0&&!profile){
  if(!settings?.directory_synced_at)return <main className={styles.page}><section className={styles.card}><h1>寄件入口正在配置</h1><p>请管理员保存企微应用并同步员工白名单后再进入。</p></section></main>
  if(query.access)return <main className={styles.page}><section className={styles.card}><h1>{query.access==='denied'?'无权使用自寄服务':'暂时无法验证寄件身份'}</h1><p>{query.access==='denied'?settings.denied_message:'请联系管理员检查企微授权域名、员工资料及预置电话。'}</p><a href="/api/shipping/public/wecom/authorize">重新使用企业微信验证</a></section></main>
  redirect('/api/shipping/public/wecom/authorize')
 }
 return <SalesPortal initialEmployee={profile?wecomProfileDto(profile):null} initialOptions={{services:options.services,rules:options.rules,requireVerification:options.requireVerification,emailAvailable:false}}/>
}
