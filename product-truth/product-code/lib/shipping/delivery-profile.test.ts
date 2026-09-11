// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { shippingRuntimeEvidenceBlockers as check } from '../../../../governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/project-registry.js'
function proof(environment='sandbox') {
 const id='PV3'+'a'.repeat(28),waybill='SF1234567890123'
 return {shipping_provider:{payload:{provider:'sf-express',success:true,endpoint:environment==='production'?'https://sfapi.sf-express.com/std/service':'https://sfapi-sbox.sf-express.com/std/service',sf_environment:environment,order_id:id}},shipping_request:{payload:{request_id:id,status:'accepted',waybill,created_by:'00000000-0000-4000-8000-000000000001'}},shipping_tracking:{payload:{success:true,waybill,event_count:0}},shipping_access:{payload:{anonymous_orders_denied:true,anonymous_contacts_denied:true,owner_can_read:true,public_page_accessible:true,same_key_single_request:true}}}
}
describe('non-AI shipping release evidence',()=>{
 it('accepts consistent sandbox evidence without pretending it is an AI run',()=>expect(check(proof(),'sandbox')).toEqual([]))
 it('does not use sandbox evidence for production',()=>expect(check(proof(),'production').length).toBeGreaterThan(0))
 it('requires matched real-production request and tracking identities',()=>{const p=proof('production');p.shipping_tracking.payload.waybill='SF9876543210123';expect(check(p,'production').length).toBeGreaterThan(0)})
 it('rejects a merely opened page with no accepted shipment',()=>expect(check({},'production').length).toBeGreaterThan(0))
 it('requires anonymous privacy and idempotency checks',()=>{const p=proof();p.shipping_access.payload.anonymous_contacts_denied=false;expect(check(p,'sandbox').length).toBeGreaterThan(0)})
})
