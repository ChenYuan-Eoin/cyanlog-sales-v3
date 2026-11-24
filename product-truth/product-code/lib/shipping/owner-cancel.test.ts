// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),cancel:vi.fn(),track:vi.fn(),connect:vi.fn(),capability:vi.fn(),recordTracking:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{rpc:m.rpc,from:m.from}}))
vi.mock('./carrier-adapter',()=>({getCarrierAdapter:()=>({connect:m.connect})}))
vi.mock('./connections',()=>({recordShippingCapability:m.capability}))
vi.mock('./tracking-store',()=>({recordTrackingResult:m.recordTracking}))
import { cancelOriginalShipment } from './owner-cancel'
import { ShippingError } from './config'
let cancelOrderRow: Record<string,unknown>
beforeEach(()=>{
 vi.resetAllMocks()
 m.connect.mockResolvedValue({cancel:m.cancel,track:m.track})
 m.track.mockResolvedValue({source:'carrier',waybill:'SF001',queriedAt:'2026-11-24T08:00:00Z',events:[{time:'2026-11-24 16:00:00',location:'北京',description:'待揽收',status:'waybill_created'}]})
 m.recordTracking.mockResolvedValue({recorded:1,shipmentStatus:'waybill_created'})
 cancelOrderRow={id:'own',org_id:'org',created_by:'employee',intake_source:'owner_web',order_no:'ref',status:'waybill_created',revision:2,provider_key:'sf',provider_order_id:'original-request',carrier_connection_id:'original',billing_account_id:'billing',connection_environment:'sandbox',shipping_waybills:{waybill_no:'SF001',carrier_key:'sf',provider_order_id:'original-request',latest_status:'waybill_created'}}
 const query={select:vi.fn(()=>query),eq:vi.fn(()=>query),maybeSingle:vi.fn().mockImplementation(async()=>({data:cancelOrderRow,error:null}))}
 m.from.mockReturnValue(query)
})
const localSnapshot = {revision:1,status:'awaiting_confirmation',waybill:null}
const issuedSnapshot = {revision:2,status:'waybill_created',waybill:'SF001'}
it('uses server actor/organization, never contacts a carrier for local cancellation, and cannot look up another employee’s order',async()=>{
 m.rpc.mockResolvedValueOnce({data:{id:'own',result:'cancelled'}}).mockResolvedValueOnce({data:{result:'missing'}})
 await expect(cancelOriginalShipment('ref','me','org',true,localSnapshot)).resolves.toEqual({id:'own',status:'cancelled'})
 expect(m.rpc).toHaveBeenCalledWith('claim_shipping_cancellation_v1',expect.objectContaining({p_actor:'me',p_org:'org',p_owner:true,p_reference:'ref',p_expected:localSnapshot}))
 await expect(cancelOriginalShipment('ref','other','org',true,localSnapshot)).rejects.toMatchObject({status:404})
 expect(m.connect).not.toHaveBeenCalled()
})
it('requires the complete displayed snapshot and returns 409 without contacting the carrier when it is stale',async()=>{
 for (const expected of [undefined,{}, {revision:1,status:'confirmed'},{...localSnapshot,revision:0}]) {
   await expect(cancelOriginalShipment('ref','me','org',true,expected)).rejects.toMatchObject({status:409})
 }
 expect(m.rpc).not.toHaveBeenCalled()
 m.rpc.mockResolvedValueOnce({data:{result:'stale'}})
 await expect(cancelOriginalShipment('ref','me','org',true,issuedSnapshot)).rejects.toMatchObject({status:409})
 expect(m.connect).not.toHaveBeenCalled()
})
it('a lost carrier response cannot become success or a second carrier action on retry',async()=>{
 const dispatch={id:'id',result:'dispatch',provider:'sf',connectionId:'original',billingAccountId:'billing',environment:'sandbox',providerOrderId:'original-request'}
 m.rpc.mockResolvedValueOnce({data:dispatch}).mockResolvedValueOnce({data:'unknown'}).mockResolvedValueOnce({data:{id:'id',result:'pending'}})
 m.cancel.mockRejectedValueOnce(new ShippingError(502,'timeout','provider_unreachable'))
 await expect(cancelOriginalShipment('ref','employee','org',true,issuedSnapshot)).rejects.toMatchObject({requestStage:'provider_unreachable'})
 expect(m.rpc.mock.calls[1][1]).toMatchObject({p_outcome:'unknown',p_order:'id',p_attempt:m.rpc.mock.calls[0][1].p_attempt})
 await expect(cancelOriginalShipment('id','operator','org',false)).rejects.toMatchObject({status:409})
 expect(m.cancel).toHaveBeenCalledExactlyOnceWith('original-request');expect(m.capability).not.toHaveBeenCalled()
})
it('refreshes a cached uncollected waybill before cancellation and refuses a waybill already signed for',async()=>{
 cancelOrderRow.connection_environment='production'
 m.track.mockResolvedValueOnce({source:'carrier',waybill:'SF001',queriedAt:'2026-11-24T08:00:00Z',events:[{time:'2026-11-20 18:41:00',location:'北京',description:'已签收',status:'delivered'}]})
 m.recordTracking.mockResolvedValueOnce({recorded:1,shipmentStatus:'delivered'})
 m.rpc.mockResolvedValueOnce({data:{id:'own',result:'dispatch',provider:'sf',connectionId:'original',billingAccountId:'billing',environment:'production',providerOrderId:'original-request'}}).mockResolvedValue({data:'not_sent'})
 await expect(cancelOriginalShipment('ref','employee','org',true,issuedSnapshot)).rejects.toMatchObject({status:409})
 expect(m.track).toHaveBeenCalledWith('SF001')
 expect(m.recordTracking).toHaveBeenCalledWith('org',expect.objectContaining({waybill:'SF001',source:'carrier'}),'sf')
 expect(m.cancel).not.toHaveBeenCalled()
 expect(m.rpc).toHaveBeenLastCalledWith('finish_shipping_cancellation_v1',expect.objectContaining({p_outcome:'not_sent'}))
})
it('returns a saved production cancellation without another carrier query',async()=>{
 cancelOrderRow.status='cancelled';cancelOrderRow.connection_environment='production'
 m.rpc.mockResolvedValueOnce({data:{id:'own',result:'cancelled'}})
 await expect(cancelOriginalShipment('ref','employee','org',true,issuedSnapshot)).resolves.toEqual({id:'own',status:'cancelled'})
 expect(m.track).not.toHaveBeenCalled();expect(m.cancel).not.toHaveBeenCalled()
})
it.each(['unknown','invalid-time','empty','failed-save'])('does not send cancellation for %s tracking evidence',async kind=>{
 cancelOrderRow.connection_environment='production'
 m.rpc.mockResolvedValueOnce({data:{id:'own',result:'dispatch',provider:'sf',connectionId:'original',billingAccountId:'billing',environment:'production',providerOrderId:'original-request'}}).mockResolvedValue({data:'not_sent'})
 m.track.mockResolvedValue({source:'carrier',waybill:'SF001',events:kind==='empty'?[]:[{time:kind==='invalid-time'?'invalid':'2026-11-24 16:00:00',status:kind==='unknown'?'unknown':'waybill_created'}]})
 if(kind==='failed-save')m.recordTracking.mockResolvedValue({recorded:0,shipmentStatus:'waybill_created'})
 await expect(cancelOriginalShipment('ref','employee','org',true,issuedSnapshot)).rejects.toMatchObject({status:503})
 expect(m.cancel).not.toHaveBeenCalled()
})
it('also verifies live tracking for an operator cancellation',async()=>{
 cancelOrderRow.connection_environment='production'
 m.rpc.mockResolvedValueOnce({data:{id:'own',result:'dispatch',provider:'sf',connectionId:'original',billingAccountId:'billing',environment:'production',providerOrderId:'original-request'}}).mockResolvedValue({data:'not_sent'})
 m.recordTracking.mockResolvedValue({recorded:1,shipmentStatus:'delivered'})
 await expect(cancelOriginalShipment('own','operator','org',false)).rejects.toMatchObject({status:409})
 expect(m.cancel).not.toHaveBeenCalled()
})
it('cancels an actually uncollected production order once using the original request and connection',async()=>{
 cancelOrderRow.connection_environment='production'
 m.rpc.mockResolvedValueOnce({data:{id:'own',result:'dispatch',provider:'sf',connectionId:'original',billingAccountId:'billing',environment:'production',providerOrderId:'original-request'}}).mockResolvedValueOnce({data:'accepted'})
 await expect(cancelOriginalShipment('ref','employee','org',true,issuedSnapshot)).resolves.toEqual({id:'own',status:'cancelled'})
 expect(m.connect).toHaveBeenCalledWith(expect.objectContaining({orgId:'org',connectionId:'original',billingAccountId:'billing',expectedEnvironment:'production'}))
 expect(m.track).toHaveBeenCalledExactlyOnceWith('SF001')
 expect(m.cancel).toHaveBeenCalledExactlyOnceWith('original-request')
 expect(m.rpc.mock.calls[1][1]).toMatchObject({p_order:'own',p_outcome:'accepted'})
})
it('does not cancel when the carrier binding changed after the claim',async()=>{
 cancelOrderRow.connection_environment='production';cancelOrderRow.carrier_connection_id='changed'
 m.rpc.mockResolvedValueOnce({data:{id:'own',result:'dispatch',provider:'sf',connectionId:'original',billingAccountId:'billing',environment:'production',providerOrderId:'original-request'}}).mockResolvedValueOnce({data:'not_sent'})
 await expect(cancelOriginalShipment('ref','employee','org',true,issuedSnapshot)).rejects.toMatchObject({status:409})
 expect(m.track).not.toHaveBeenCalled();expect(m.cancel).not.toHaveBeenCalled()
})
