import { after, NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from '@/lib/shipping/config'
import { readWecomBotForCallback, wecomBotKeys } from '@/lib/shipping/wecom-bot-settings'
import { decryptWecomCallback, encryptWecomCallback } from '@/lib/shipping/wecom-callback-crypto'
import { enqueueWecomBotEvent, readWecomBotEvent, processWecomBotEvent, botStreamReply, BOT_INTAKE_HELP } from '@/lib/shipping/wecom-bot-events'
export const runtime='nodejs'
export const maxDuration=60
const query=(req:NextRequest)=>({signature:req.nextUrl.searchParams.get('msg_signature')||'',timestamp:req.nextUrl.searchParams.get('timestamp')||'',nonce:req.nextUrl.searchParams.get('nonce')||''})
function failure(error:unknown){return NextResponse.json({error:error instanceof ShippingError?error.message:'回调消息无效。'},{status:error instanceof ShippingError?error.status:400,headers:{'Cache-Control':'no-store'}})}
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
 try {
  const bot=await readWecomBotForCallback((await params).id),keys=wecomBotKeys(bot)
  const plain=decryptWecomCallback(keys,query(req),req.nextUrl.searchParams.get('echostr')||'')
  after(async()=>{const result=await supabaseAdmin.from('shipping_wecom_bots').update({verified_at:new Date().toISOString()}).eq('id',bot.id).eq('credentials_ciphertext',bot.credentials_ciphertext);if(result.error)console.warn('shipping.bot.verification_not_recorded',{bot:bot.id})})
  return new NextResponse(plain,{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}})
 }catch(error){return failure(error)}
}
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
 try {
  const bot=await readWecomBotForCallback((await params).id),keys=wecomBotKeys(bot),q=query(req)
  const raw=await req.text();if(raw.length>20000)throw new ShippingError(413,'回调消息过长。')
  const encrypted=z.object({encrypt:z.string().max(19000)}).parse(JSON.parse(raw))
  const value=JSON.parse(decryptWecomCallback(keys,q,encrypted.encrypt))
  const base=z.object({aibotid:z.literal(bot.bot_id),msgtype:z.string(),from:z.object({userid:z.string().min(1).max(256)}),chattype:z.enum(['single','group']),chatid:z.string().max(256).optional()}).parse(value)
  const reply=(message:unknown)=>NextResponse.json(encryptWecomCallback(keys,JSON.stringify(message),q.nonce),{headers:{'Cache-Control':'no-store'}})
  if(base.msgtype!=='stream')after(async()=>{const now=new Date().toISOString();await supabaseAdmin.from('shipping_wecom_bots').update({last_message_at:now,verified_at:bot.verified_at||now}).eq('id',bot.id)})
  if(bot.status!=='active')return reply({msgtype:'stream',stream:{id:crypto.randomUUID(),finish:true,content:'机器人回调已收到，尚待管理员在配置中心启用。'}})
  if(base.msgtype==='stream'){
   const stream=z.object({stream:z.object({id:z.uuid()})}).parse(value)
   const event=await readWecomBotEvent(bot,stream.stream.id,{userid:base.from.userid,chatid:base.chatid,chattype:base.chattype})
   if(event.state==='pending'||event.state==='processing')after(()=>processWecomBotEvent(bot.id,event.id))
   return reply(botStreamReply(event))
  }
  if(base.msgtype!=='text'||value.compat_info)return reply({msgtype:'stream',stream:{id:crypto.randomUUID(),finish:true,content:BOT_INTAKE_HELP}})
  const event=await enqueueWecomBotEvent(bot,value)
  if(event.state==='pending'||event.state==='processing')after(()=>processWecomBotEvent(bot.id,event.id))
  return reply(botStreamReply(event))
 }catch(error){return failure(error)}
}
