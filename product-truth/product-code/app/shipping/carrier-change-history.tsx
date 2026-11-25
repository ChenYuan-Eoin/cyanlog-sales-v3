import type { CarrierChangeReceipt } from '@/lib/shipping/owner-carrier-change'
import type { Contact } from '@/lib/shipping/types'

const descriptions = {
  pending: '指令正在处理，等待顺丰回执。',
  accepted: '顺丰已受理指令，实际处理结果待确认。',
  unknown: '尚未取得顺丰的明确回执，处理结果待核实。',
  rejected: '顺丰已拒绝本次指令。',
  not_sent: '本次指令尚未发往顺丰。',
}
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

export function ContactLine({ contact }: { contact: Contact }) {
  return <>{contact.name} · {contact.phone}<br />{contact.province}{contact.city === contact.province ? '' : contact.city}{contact.county}{contact.address}</>
}

export function CarrierChangeHistory({ receipt }: { receipt: CarrierChangeReceipt }) {
  return <section aria-label="顺丰指令记录">
    <strong>{receipt.action === 'return_to_sender' ? '快件退回' : '收件地址修改'}</strong>
    <p>提交时间 <time dateTime={receipt.requestedAt}>{timeFormat.format(new Date(receipt.requestedAt))}</time></p>
    <dl>
      <dt>原收件地址</dt><dd><ContactLine contact={receipt.originalRecipient} /></dd>
      <dt>{receipt.action === 'return_to_sender' ? '退回目的地' : '申请的新收件地址'}</dt><dd><ContactLine contact={receipt.destination} /></dd>
      {receipt.instructionId && <><dt>顺丰指令号</dt><dd>{receipt.instructionId}</dd></>}
      {receipt.amount != null && <><dt>顺丰回执金额</dt><dd>{receipt.amount}</dd></>}
    </dl>
    <p role="status">{descriptions[receipt.status]}</p>
  </section>
}

export function hasReceipt(value: Partial<CarrierChangeReceipt> | null): value is CarrierChangeReceipt {
  return Boolean(value && value.status && Object.hasOwn(descriptions, value.status)
    && value.originalRecipient && value.destination && value.requestedAt && Number.isFinite(Date.parse(value.requestedAt)))
}
