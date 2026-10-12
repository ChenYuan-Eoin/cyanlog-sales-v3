import type { NextRequest } from 'next/server'
import { shippingManagerHandler,shippingJson } from '@/lib/shipping/http'
import { listWecomMembers,readWecomSettings,publicWecomSettings,prepareWecomConfiguration,activateWecomConfiguration,discardWecomConfiguration,readWecomDraft,saveWecomDepartmentScope,syncWecomDirectory,updateWecomMember } from '@/lib/shipping/wecom-settings'
import { ShippingError } from '@/lib/shipping/config'
export const runtime='nodejs'
export async function GET(req:NextRequest){return shippingManagerHandler(req,async(_user,orgId)=>({settings:publicWecomSettings(await readWecomSettings(orgId)),members:await listWecomMembers(orgId),draft:await readWecomDraft(orgId)}))}
export async function POST(req:NextRequest){return shippingManagerHandler(req,async(user,orgId)=>{
 const body=await shippingJson(req) as {action?:string;settings?:unknown;member?:unknown;draftId?:unknown;departmentIds?:unknown}
 if(body.action==='save')throw new ShippingError(409,'配置维护已升级，请刷新页面后测试和启用新配置。')
 if(body.action==='prepare')return {settings:publicWecomSettings(await readWecomSettings(orgId)),members:await listWecomMembers(orgId),draft:await prepareWecomConfiguration(orgId,user.id,body.settings)}
 if(body.action==='discard'){await discardWecomConfiguration(orgId,body.draftId);return {settings:publicWecomSettings(await readWecomSettings(orgId)),members:await listWecomMembers(orgId),draft:null}}
 if(body.action==='activate'){await activateWecomConfiguration(orgId,user.id,{draftId:body.draftId,departmentIds:body.departmentIds});return {settings:publicWecomSettings(await readWecomSettings(orgId)),members:await listWecomMembers(orgId),draft:null}}
 if(body.action==='scope'){await saveWecomDepartmentScope(orgId,body.departmentIds);return {settings:publicWecomSettings(await readWecomSettings(orgId)),members:await listWecomMembers(orgId),draft:await readWecomDraft(orgId)}}
 if(body.action==='sync')return syncWecomDirectory(orgId)
 if(body.action==='member')return {settings:publicWecomSettings(await readWecomSettings(orgId)),members:await updateWecomMember(orgId,body.member)}
 throw new ShippingError(400,'不支持的企微配置操作。')
})}
