import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { shippingJson } from '@/lib/shipping/http'
import { ShippingError } from '@/lib/shipping/config'
import { contactSchema } from '@/lib/shipping/validation'
import { getWecomSession,revokeWecomSession,wecomProfileDto,WECOM_SESSION_COOKIE } from '@/lib/shipping/wecom-session'
export const runtime='nodejs'
export const dynamic='force-dynamic'
function failure(error:unknown){return NextResponse.json({error:error instanceof ShippingError?error.message:'员工寄件资料暂不可用。'},{status:error instanceof ShippingError?error.status:error instanceof z.ZodError?400:503,headers:{'Cache-Control':'private, no-store'}})}
export async function GET(req:NextRequest){try{const profile=await getWecomSession(req);return NextResponse.json({employee:profile?wecomProfileDto(profile):null},{headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}})}catch(e){return failure(e)}}
export async function POST(req:NextRequest){try{
 if(req.headers.get('origin')!==req.nextUrl.origin)throw new ShippingError(403,'请求来源不受信任。')
 const body=await shippingJson(req) as {action?:string;profile?:unknown}
 if(body.action==='logout'){await revokeWecomSession(req);const reply=NextResponse.json({employee:null});reply.cookies.set(WECOM_SESSION_COOKIE,'',{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:0});return reply}
 if(body.action!=='save_profile')throw new ShippingError(410,'邮箱验证已停用，请使用企业微信身份入口。')
 const profile=await getWecomSession(req)
 if(!profile)throw new ShippingError(401,'请先通过企业微信验证身份。')
 const input=z.object({sender:contactSchema,team:z.string().optional(),expectedUpdatedAt:z.string()}).strict().parse(body.profile)
 if(input.sender.name!==profile.name||input.sender.phone!==profile.phone)throw new ShippingError(403,'姓名和电话由企微身份或管理员预置资料确定，员工不能修改。')
 const {data,error}=await supabaseAdmin.from('shipping_employee_profiles').update({sender_contact:input.sender,updated_at:new Date().toISOString()}).eq('id',profile.id).eq('org_id',profile.orgId).eq('updated_at',input.expectedUpdatedAt).select('id').maybeSingle()
 if(error||!data)throw new ShippingError(409,'资料已变化，请重新读取后保存。')
 const saved=await getWecomSession(req)
 return NextResponse.json({employee:saved?wecomProfileDto(saved):null},{headers:{'Cache-Control':'private, no-store'}})
}catch(e){return failure(e)}}
