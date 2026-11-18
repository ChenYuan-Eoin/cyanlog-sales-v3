// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({rpc:vi.fn(),cancel:vi.fn(),connect:vi.fn(),capability:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{rpc:m.rpc}}))
vi.mock('./carrier-adapter',()=>({getCarrierAdapter:()=>({connect:m.connect})}))
vi.mock('./connections',()=>({recordShippingCapability:m.capability}))
import { cancelOriginalShipment } from './owner-cancel'
import { ShippingError } from './config'
beforeEach(()=>{vi.resetAllMocks();m.connect.mockResolvedValue({cancel:m.cancel})})
it('uses server actor/organization, never contacts a carrier for local cancellation, and cannot look up another employee’s order',async()=>{
 m.rpc.mockResolvedValueOnce({data:{id:'own',result:'cancelled'}}).mockResolvedValueOnce({data:{result:'missing'}})
 await expect(cancelOriginalShipment('ref','me','org',true)).resolves.toEqual({id:'own',status:'cancelled'})
 expect(m.rpc).toHaveBeenCalledWith('claim_shipping_cancellation_v1',expect.objectContaining({p_actor:'me',p_org:'org',p_owner:true,p_reference:'ref'}))
 await expect(cancelOriginalShipment('ref','other','org',true)).rejects.toMatchObject({status:404})
 expect(m.connect).not.toHaveBeenCalled()
})
it('a lost carrier response cannot become success or a second carrier action on retry',async()=>{
 const dispatch={id:'id',result:'dispatch',provider:'sf',connectionId:'original',billingAccountId:'billing',environment:'sandbox',providerOrderId:'original-request'}
 m.rpc.mockResolvedValueOnce({data:dispatch}).mockResolvedValueOnce({data:'unknown'}).mockResolvedValueOnce({data:{id:'id',result:'pending'}})
 m.cancel.mockRejectedValueOnce(new ShippingError(502,'timeout','provider_unreachable'))
 await expect(cancelOriginalShipment('ref','employee','org',true)).rejects.toMatchObject({requestStage:'provider_unreachable'})
 expect(m.rpc.mock.calls[1][1]).toMatchObject({p_outcome:'unknown',p_order:'id',p_attempt:m.rpc.mock.calls[0][1].p_attempt})
 await expect(cancelOriginalShipment('id','operator','org',false)).rejects.toMatchObject({status:409})
 expect(m.cancel).toHaveBeenCalledExactlyOnceWith('original-request');expect(m.capability).not.toHaveBeenCalled()
})
