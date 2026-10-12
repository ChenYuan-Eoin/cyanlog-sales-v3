import type { NextRequest } from 'next/server'
import { shippingManagerHandler,shippingJson } from '@/lib/shipping/http'
import { listWecomMembers,readWecomSettings,publicWecomSettings,saveWecomSettings,syncWecomDirectory,updateWecomMember } from '@/lib/shipping/wecom-settings'
import { ShippingError } from '@/lib/shipping/config'
export const runtime='nodejs'
export async function GET(req:NextRequest){return shippingManagerHandler(req,async(_user,orgId)=>({settings:publicWecomSettings(await readWecomSettings(orgId)),members:await listWecomMembers(orgId)}))}
export async function POST(req:NextRequest){return shippingManagerHandler(req,async(user,orgId)=>{
 const body=await shippingJson(req) as {action?:string;settings?:unknown;member?:unknown}
 if(body.action==='save')return {...await saveWecomSettings(orgId,user.id,body.settings),members:await listWecomMembers(orgId)}
 if(body.action==='sync')return syncWecomDirectory(orgId)
 if(body.action==='member')return {settings:publicWecomSettings(await readWecomSettings(orgId)),members:await updateWecomMember(orgId,body.member)}
 throw new ShippingError(400,'不支持的企微配置操作。')
})}
