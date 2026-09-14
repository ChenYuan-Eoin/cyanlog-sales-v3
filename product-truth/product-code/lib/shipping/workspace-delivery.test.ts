import { describe, expect, it } from 'vitest'
import { shippingWorkspaceEvidenceBlockers } from '../../../../governance/runtime-config-AI运行配置/runtime-code-运行代码/scripts-脚本/project-registry.js'
function proof() { return { shipping_workspace: { payload: { page_accessible: true, address_book_usable: true, form_editable: true, payment_choices: ['sender_cash','recipient','sender_monthly'], production_submission_disabled: true, outbound_count: 10 } }, shipping_tracking: { payload: { success: true, waybill: 'SF1234567890123', event_count: 3, endpoint: 'https://sfapi.sf-express.com/std/service' } }, shipping_access: { payload: { anonymous_orders_denied: true, anonymous_contacts_denied: true, owner_can_read: true, foreign_waybill_denied: true } } } }
describe('workspace release proof follows the user scope without paid test orders', () => {
  it('accepts an evidence-complete workspace and real tracking', () => expect(shippingWorkspaceEvidenceBlockers(proof(), 'production')).toEqual([]))
  it('rejects enabled paid submission', () => { const p=proof();p.shipping_workspace.payload.production_submission_disabled=false;expect(shippingWorkspaceEvidenceBlockers(p,'production').length).toBeGreaterThan(0) })
  it('rejects sandbox evidence presented as production', () => { const p=proof();p.shipping_tracking.payload.endpoint='https://sfapi-sbox.sf-express.com/std/service';expect(shippingWorkspaceEvidenceBlockers(p,'production').length).toBeGreaterThan(0) })
  it('rejects an empty outbound list and missing isolation', () => { const p=proof();p.shipping_workspace.payload.outbound_count=0;p.shipping_access.payload.foreign_waybill_denied=false;expect(shippingWorkspaceEvidenceBlockers(p,'production')).toHaveLength(2) })
})
