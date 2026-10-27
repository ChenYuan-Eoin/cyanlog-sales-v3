import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import type { ShippingInput } from './types'
// Identical unfinished shipments reuse one key even if WeCom assigns new msgids.
// A delivered/cancelled matching shipment starts the next lifecycle. The existing
// unique order key handles concurrent sends; no read-then-insert-only dedup.
export async function wecomBotSubmissionKey(orgId:string,employeeId:string,input:ShippingInput) {
 const payloadHash=createHash('sha256').update(JSON.stringify({...input,serviceName:undefined})).digest('hex')
 const {data,error}=await supabaseAdmin.from('shipping_orders').select('id').eq('org_id',orgId).eq('employee_profile_id',employeeId).eq('intake_source','anonymous_web').eq('payload_hash',payloadHash).in('status',['cancelled','delivered']).order('created_at',{ascending:false}).limit(1).maybeSingle()
 if(error)throw new ShippingError(503,'原工单暂不可核对，本次未重复提报。')
 const digest=createHash('sha256').update(JSON.stringify(['wecom-intake-v1',orgId,employeeId,payloadHash,data?.id||'first'])).digest('hex')
 return `${digest.slice(0,8)}-${digest.slice(8,12)}-8${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`
}
