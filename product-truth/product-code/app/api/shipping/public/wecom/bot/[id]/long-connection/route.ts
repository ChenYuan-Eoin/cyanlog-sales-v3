import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ShippingError } from '@/lib/shipping/config'
import {
  markWecomLongConnectionMessage,
  markWecomLongConnectionOnline,
  readWecomBotForLongConnection,
  wecomLongConnectionSecret,
} from '@/lib/shipping/wecom-bot-settings'
import {
  botStreamReply,
  enqueueWecomBotEvent,
  processWecomBotEvent,
  readWecomBotEvent,
} from '@/lib/shipping/wecom-bot-events'
import { verifyWecomBotRuntimeRequest } from '@/lib/shipping/wecom-bot-runtime'

export const runtime='nodejs'
export const maxDuration=60

const frameSchema=z.object({
  msgid:z.string().min(1).max(512),
  aibotid:z.string().min(1).max(128),
  from:z.object({userid:z.string().min(1).max(256)}),
  chattype:z.enum(['single','group']),
  chatid:z.string().max(256).optional(),
  msgtype:z.string(),
  text:z.object({content:z.string().max(4000)}).optional(),
}).passthrough()

const requestSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('heartbeat'),runtime:z.object({
    version:z.string().min(1).max(80),
    host:z.string().min(1).max(120).optional(),
    phase:z.string().min(1).max(80),
    authenticated:z.boolean(),
    business_ready:z.boolean(),
    received_messages:z.number().int().nonnegative().optional(),
    replied_messages:z.number().int().nonnegative().optional(),
    message_errors:z.number().int().nonnegative().optional(),
    reconnect_attempts:z.number().int().nonnegative().optional(),
  }).passthrough()}),
  z.object({action:z.literal('message'),frame:frameSchema}),
])

function failure(error:unknown) {
  return NextResponse.json(
    {error:error instanceof ShippingError?error.message:'机器人运行请求无效。'},
    {status:error instanceof ShippingError?error.status:400,headers:{'Cache-Control':'no-store'}},
  )
}

export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
  try {
    const id=(await params).id
    const raw=await req.text()
    if(raw.length>20000)throw new ShippingError(413,'机器人运行请求过长。')
    let bot=await readWecomBotForLongConnection(id)
    verifyWecomBotRuntimeRequest({
      secret:wecomLongConnectionSecret(bot),
      timestamp:req.headers.get('x-wecom-runtime-timestamp'),
      signature:req.headers.get('x-wecom-runtime-signature'),
      body:raw,
    })
    const input=requestSchema.parse(JSON.parse(raw))
    if(input.action==='heartbeat') {
      if(input.runtime.authenticated && input.runtime.business_ready)await markWecomLongConnectionOnline(bot)
      return NextResponse.json({
        ok:true,
        bot_id:bot.bot_id,
        server_time:new Date().toISOString(),
        runtime_version:input.runtime.version,
      },{headers:{'Cache-Control':'no-store'}})
    }

    if(input.frame.aibotid!==bot.bot_id)throw new ShippingError(403,'机器人身份不匹配。')
    if(input.frame.chattype!=='single')return NextResponse.json({msgtype:'stream',stream:{id:randomUUID(),finish:true,content:'为保护寄件隐私，请单聊机器人发送收件信息或查询本人工单。'}},{headers:{'Cache-Control':'no-store'}})
    if(input.frame.msgtype!=='text'||!input.frame.text) {
      return NextResponse.json({msgtype:'stream',stream:{id:randomUUID(),finish:true,content:'请发送“寄件”开始提报，或发送“查询我的工单”。'}},{headers:{'Cache-Control':'no-store'}})
    }
    await markWecomLongConnectionOnline(bot)
    bot=await readWecomBotForLongConnection(id)
    if(bot.status!=='active')throw new ShippingError(409,'机器人尚未确认在线。')
    await markWecomLongConnectionMessage(bot)
    const event=await enqueueWecomBotEvent(bot,input.frame)
    if(event.state==='pending'||event.state==='processing')await processWecomBotEvent(bot.id,event.id)
    const current=await readWecomBotEvent(bot,event.id,{
      userid:input.frame.from.userid,
      chatid:input.frame.chatid,
      chattype:input.frame.chattype,
    })
    return NextResponse.json(botStreamReply(current),{headers:{'Cache-Control':'no-store'}})
  }catch(error) {
    return failure(error)
  }
}
