import type { NextRequest } from 'next/server'
import { shippingManagerHandler, shippingJson } from '@/lib/shipping/http'
import { listWecomBots, prepareWecomBot, activateWecomBot, disableWecomBot, revealWecomBotSetup } from '@/lib/shipping/wecom-bot-settings'
import { ShippingError } from '@/lib/shipping/config'
export const runtime='nodejs'
export async function GET(req:NextRequest) { return shippingManagerHandler(req,async(_user,orgId)=>({bots:await listWecomBots(orgId)})) }
export async function POST(req:NextRequest) { return shippingManagerHandler(req,async(user,orgId)=>{
 const body=await shippingJson(req) as {action?:string;bot?:unknown;id?:unknown}
 if(body.action==='setup')return {...await revealWecomBotSetup(orgId,body.id),bots:await listWecomBots(orgId)}
 if(body.action==='prepare')return {...await prepareWecomBot(orgId,user.id,body.bot),bots:await listWecomBots(orgId)}
 if(body.action==='activate')await activateWecomBot(orgId,user.id,body.id)
 else if(body.action==='disable')await disableWecomBot(orgId,user.id,body.id)
 else throw new ShippingError(400,'不支持的机器人配置操作。')
 return {bots:await listWecomBots(orgId)}
}) }
