'use client'

import { useState, type FormEvent } from 'react'
import { ArrowRight, Building2, CheckCircle2, ClipboardPaste, Package, Sparkles, UserRound } from 'lucide-react'
import { parseAddress } from '@/lib/shipping/address'
import { emptyContact, type Contact, type ShipmentReceipt } from '@/lib/shipping/types'
import styles from './sales-portal.module.css'

export default function SalesPortal() {
  const [submitter, setSubmitter] = useState({ name: '', phone: '', team: '' })
  const [customerName, setCustomerName] = useState('')
  const [recipient, setRecipient] = useState<Contact>(emptyContact)
  const [rawAddress, setRawAddress] = useState('')
  const [cargo, setCargo] = useState('合同')
  const [count, setCount] = useState('1')
  const [servicePreference, setServicePreference] = useState<'standard' | 'urgent'>('standard')
  const [specialRequirements, setSpecialRequirements] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<(ShipmentReceipt & { receiptToken?: string }) | null>(null)

  function setRecipientField(key: keyof Contact, value: string) { setRecipient(current => ({ ...current, [key]: value })) }
  function recognize() {
    const result = parseAddress(rawAddress)
    setRecipient(result.contact)
    setError(result.warnings.join(' '))
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const query = new URLSearchParams(window.location.search)
      const response = await fetch('/api/shipping/public/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: crypto.randomUUID(), rawInput: rawAddress || undefined, contextToken: query.get('context') || undefined, businessCode: query.get('code') || undefined, input: { recipient, cargo, weight: Math.max(1, Number(count)), servicePreference, remark: '', source: 'manual', payment: 'sender_monthly', customerName, submittedBy: submitter, specialRequirements } }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '提交暂未完成')
      setReceipt(data)
    } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }

  if (receipt) return <main className={styles.page}><section className={styles.successCard}><div className={styles.successIcon}><CheckCircle2 size={34}/></div><p>提交成功</p><h1>已提交前台处理</h1><span>业务流水号</span><strong>{receipt.orderNo}</strong><small>前台确认后会生成承运商运单。如需补充信息，请联系前台并提供此流水号。</small><button onClick={() => window.location.reload()}>继续提报一票</button></section></main>

  return <main className={styles.page}>
    <header className={styles.header}><div className={styles.brand}><span>O</span><div><strong>自助收寄</strong><small>销售寄件提报</small></div></div><div className={styles.secure}>免登录 · 安全提交</div></header>
    <div className={styles.hero}><div><p>SALES SHIPPING REQUEST</p><h1>把寄件信息交给前台，<br/>剩下的流程我们来处理。</h1><span>填写客户和收件信息，提交后即可获得业务流水号。</span></div><div className={styles.steps}><span className={styles.current}>1 填写信息</span><i/><span>2 前台确认</span><i/><span>3 快递揽收</span></div></div>
    <form className={styles.form} onSubmit={submit}>
      <section className={styles.card}><div className={styles.cardTitle}><UserRound size={18}/><div><h2>提报人信息</h2><p>便于前台需要时联系你</p></div></div><div className={styles.grid3}><label>姓名<input required maxLength={60} value={submitter.name} onChange={event => setSubmitter({ ...submitter, name: event.target.value })} placeholder="你的姓名"/></label><label>手机号<input required inputMode="tel" maxLength={11} value={submitter.phone} onChange={event => setSubmitter({ ...submitter, phone: event.target.value.replace(/\D/g, '') })} placeholder="11位手机号"/></label><label>所属团队<input required maxLength={80} value={submitter.team} onChange={event => setSubmitter({ ...submitter, team: event.target.value })} placeholder="如：华南销售部"/></label></div></section>
      <section className={styles.card}><div className={styles.cardTitle}><Building2 size={18}/><div><h2>客户与收件信息</h2><p>客户、收件人和城市会显示在前台待办卡片</p></div></div><label className={styles.customer}>客户名称<input required maxLength={120} value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder="公司或项目客户名称"/></label><div className={styles.paste}><div><ClipboardPaste size={16}/><strong>智能地址一键粘贴</strong><span>把微信里的整段地址直接贴进来</span></div><textarea aria-label="智能地址一键粘贴" rows={3} value={rawAddress} onChange={event => setRawAddress(event.target.value)} placeholder="例如：张三 13800138000 广东省深圳市南山区科苑路15号"/><button type="button" onClick={recognize}><Sparkles size={14}/>识别并填充</button></div><div className={styles.grid2}><label>收件人<input required value={recipient.name} onChange={event => setRecipientField('name', event.target.value)}/></label><label>联系电话<input required value={recipient.phone} onChange={event => setRecipientField('phone', event.target.value)}/></label></div><div className={styles.grid3}><label>省份<input required value={recipient.province} onChange={event => setRecipientField('province', event.target.value)}/></label><label>城市<input required value={recipient.city} onChange={event => setRecipientField('city', event.target.value)}/></label><label>区县<input required value={recipient.county} onChange={event => setRecipientField('county', event.target.value)}/></label></div><label>详细地址<input required value={recipient.address} onChange={event => setRecipientField('address', event.target.value)}/></label></section>
      <section className={styles.card}><div className={styles.cardTitle}><Package size={18}/><div><h2>物品与特殊需求</h2><p>特殊要求会醒目标记给前台确认</p></div></div><div className={styles.grid3}><label>托寄物<select value={cargo} onChange={event => setCargo(event.target.value)}><option>发票</option><option>合同</option><option>样品</option><option>礼品</option><option>其他</option></select></label><label>预估件数<input type="number" min="1" max="20" value={count} onChange={event => setCount(event.target.value)}/></label><label>时效偏好<select value={servicePreference} onChange={event => setServicePreference(event.target.value as typeof servicePreference)}><option value="standard">标准</option><option value="urgent">加急</option></select></label></div><label>我的特殊需求（选填）<textarea rows={3} maxLength={500} value={specialRequirements} onChange={event => setSpecialRequirements(event.target.value)} placeholder="例如：周五前送达、样品易碎、上门前联系、随件附带某份资料……"/><span className={styles.counter}>{specialRequirements.length}/500</span></label></section>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <footer className={styles.submit}><div><CheckCircle2 size={16}/><span>提交只会进入前台待确认池，不会直接产生运费。</span></div><button disabled={busy}>{busy ? '提交中…' : '提交寄件需求'}<ArrowRight size={16}/></button></footer>
    </form>
  </main>
}
