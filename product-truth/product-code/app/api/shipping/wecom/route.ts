import type { NextRequest } from 'next/server'
import { shippingManagerHandler,shippingJson } from '@/lib/shipping/http'
import { listWecomMembers,readWecomSettings,publicWecomSettings,prepareWecomConfiguration,activateWecomConfiguration,discardWecomConfiguration,readWecomDraft,syncWecomDirectory } from '@/lib/shipping/wecom-settings'
import { ShippingError } from '@/lib/shipping/config'
export const runtime='nodejs'
export async function GET(req:NextRequest){return shippingManagerHandler(req,async(_user,orgId)=>({settings:publicWecomSettings(await readWecomSettings(orgId)),members:await listWecomMembers(orgId),draft:await readWecomDraft(orgId)}))}
export async function POST(req:NextRequest){return shippingManagerHandler(req,async(user,orgId)=>{
 const body=await shippingJson(req) as {action?:string;settings?:unknown;draftId?:unknown;scopeMode?:unknown}
 if(body.action==='save')throw new ShippingError(409,'配置维护已升级，请刷新页面后测试和启用新配置。')
 if(body.action==='prepare')return {settings:publicWecomSettings(await readWecomSettings(orgId)),members:await listWecomMembers(orgId),draft:await prepareWecomConfiguration(orgId,user.id,body.settings)}
 if(body.action==='discard'){await discardWecomConfiguration(orgId,body.draftId);return {settings:publicWecomSettings(await readWecomSettings(orgId)),members:await listWecomMembers(orgId),draft:null}}
 if(body.action==='activate'){await activateWecomConfiguration(orgId,user.id,{draftId:body.draftId,scopeMode:body.scopeMode});return {settings:publicWecomSettings(await readWecomSettings(orgId)),members:await listWecomMembers(orgId),draft:null}}
 if(body.action==='scope'||body.action==='member')throw new ShippingError(409,'寄件不再单独编辑人员或部门授权。现有范围保持不变，请在企业应用中维护人员可见范围。')
 if(body.action==='sync')return syncWecomDirectory(orgId)
 throw new ShippingError(400,'不支持的企微配置操作。')
})}
