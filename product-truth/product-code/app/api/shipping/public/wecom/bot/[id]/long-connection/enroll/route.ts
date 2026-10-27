import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ShippingError } from '@/lib/shipping/config'
import { redeemLongConnectionEnrollment } from '@/lib/shipping/wecom-bot-settings'

export const runtime='nodejs'

export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
  try {
    const raw=await req.text()
    if(raw.length>2000)throw new ShippingError(413,'云桌面接入请求过长。')
    const {token}=z.object({token:z.string().min(1).max(512)}).strict().parse(JSON.parse(raw))
    const result=await redeemLongConnectionEnrollment((await params).id,token)
    return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}})
  }catch(error) {
    return NextResponse.json(
      {error:error instanceof ShippingError?error.message:'云桌面接入失败。'},
      {status:error instanceof ShippingError?error.status:400,headers:{'Cache-Control':'no-store'}},
    )
  }
}
