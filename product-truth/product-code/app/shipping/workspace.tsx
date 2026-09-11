"use client"
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Package, Search, ClipboardPaste, ArrowUpRight, Copy, Loader2, CheckCircle2, CircleAlert, RefreshCw } from 'lucide-react'
import { parseAddress } from '@/lib/shipping/address'
import { emptyContact, type Contact, type SavedShippingContact, type ShippingInput, type ShippingRecord, type ShippingSettings, type TrackingResult } from '@/lib/shipping/types'
import { shippingInputSchema, contactSchema } from '@/lib/shipping/validation'
import styles from './workspace.module.css'
class ShippingApiError extends Error { constructor(message: string, public requestStage?: string) { super(message) } }
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' })
  const data = await response.json()
  if (!response.ok) throw new ShippingApiError(data.error || '操作暂未完成，请稍后重试。', data.requestStage)
  return data as T
}
function ContactFields({ title, mark, value, onChange, disabled }: { title: string; mark: string; value: Contact; onChange: (v: Contact) => void; disabled: boolean }) {
  const input = (key: keyof Contact, label: string, placeholder: string, max = 60) => <label className={styles.field}><span>{label}</span><input aria-label={`${title}${label}`} required maxLength={max} value={value[key]} placeholder={placeholder} autoComplete="off" onChange={e => onChange({ ...value, [key]: e.target.value })} /></label>
  return <fieldset disabled={disabled} className={styles.contact}><legend><b className={mark === '收' ? styles.receiveMark : styles.sendMark}>{mark}</b>{title}</legend><div className={styles.two}>{input('name', '姓名', '姓名或公司联系人')}{input('phone', '联系电话', '手机号 / 座机', 30)}</div><div className={styles.three}>{input('province', '省份', '省 / 直辖市', 30)}{input('city', '城市', '城市', 30)}{input('county', '区县', '区 / 县', 30)}</div>{input('address', '详细地址', '街道、楼宇及门牌号', 200)}</fieldset>
}
export default function ShippingWorkspace({ settings, userId }: { settings: ShippingSettings; userId: string }) {
  const [sender, setSender] = useState<Contact>(settings.lastShipment?.sender || settings.sender), [recipient, setRecipient] = useState<Contact>(settings.lastShipment?.recipient || emptyContact)
  const [rawAddress, setRawAddress] = useState(''), [parseNote, setParseNote] = useState('')
  const [cargo, setCargo] = useState(settings.lastShipment?.cargo || '文件'), [weight, setWeight] = useState(String(settings.lastShipment?.weight || 1)), [serviceId, setServiceId] = useState(String(settings.services.some(x => x.id === settings.lastShipment?.serviceId) ? settings.lastShipment?.serviceId : settings.services[0]?.id || '')), [remark, setRemark] = useState(settings.lastShipment?.remark || '')
  const [waybill, setWaybill] = useState(''), [phoneSuffix, setPhoneSuffix] = useState(''), [tracking, setTracking] = useState<TrackingResult | null>(null), [queryBusy, setQueryBusy] = useState(false), [queryError, setQueryError] = useState('')
  const [records, setRecords] = useState<ShippingRecord[]>([]), [recentError, setRecentError] = useState(''), [recentLoading, setRecentLoading] = useState(true)
  const [record, setRecord] = useState<ShippingRecord | null>(null), [sendBusy, setSendBusy] = useState(false), [sendError, setSendError] = useState(''), [confirmation, setConfirmation] = useState<ShippingInput | null>(null)
  const [copied, setCopied] = useState(''), [reconcileId, setReconcileId] = useState(''), [retryLocked, setRetryLocked] = useState(false)
  const [bookOpen, setBookOpen] = useState(false), [bookBusy, setBookBusy] = useState(false), [bookError, setBookError] = useState(''), [contacts, setContacts] = useState<SavedShippingContact[]>([]), [addressLabel, setAddressLabel] = useState('常用寄件地址')
  const submitLock = useRef(false), key = useRef(''), querySequence = useRef(0)
  const storageKey = `shipping-request:${userId}:${settings.environment}`
  useEffect(() => { if (settings.guest) return; try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); if (saved?.key && shippingInputSchema.safeParse(saved.input).success) { key.current = saved.key; setSender(saved.input.sender); setRecipient(saved.input.recipient); setCargo(saved.input.cargo); setWeight(String(saved.input.weight)); setServiceId(String(saved.input.serviceId)); setRemark(saved.input.remark); setConfirmation(saved.input); setRetryLocked(true) } } catch { /* no browser persistence */ } }, [storageKey, settings.guest])
  const refresh = useCallback(async () => { setRecentLoading(true); try { const data = await api<{ records: ShippingRecord[]; current?: ShippingRecord | null }>(`/api/shipping/orders${key.current ? '?key=' + encodeURIComponent(key.current) : ''}`); setRecords(data.records); if (data.current) { setRecord(data.current); setConfirmation(null) }; setRecentError('') } catch (e) { setRecentError((e as Error).message) } finally { setRecentLoading(false) } }, [])
  useEffect(() => { if (settings.guest) { setRecentLoading(false); return } void refresh() }, [refresh, settings.guest])
  async function query(number = waybill) {
    const seq = ++querySequence.current
    setQueryBusy(true); setQueryError(''); setTracking(null)
    try { const result = await api<TrackingResult>('/api/shipping/tracking', { waybill: number.trim(), ...(phoneSuffix ? { phoneSuffix } : {}) }); if (seq === querySequence.current) setTracking(result) }
    catch (e) { if (seq === querySequence.current) setQueryError((e as Error).message) }
    finally { if (seq === querySequence.current) setQueryBusy(false) }
  }
  function prepare(e: FormEvent) {
    e.preventDefault(); setSendError('')
    const parsed = shippingInputSchema.safeParse({ sender, recipient, cargo, weight: Number(weight), serviceId: Number(serviceId), remark, source: 'manual' })
    if (!parsed.success) { setSendError(parsed.error.issues.map(i => i.message).join('；')); return }
    setConfirmation(parsed.data)
  }
  async function submit() {
    if (!confirmation || submitLock.current) return
    submitLock.current = true; setSendBusy(true); setSendError('')
    key.current ||= crypto.randomUUID()
    try { sessionStorage.setItem(storageKey, JSON.stringify({ key: key.current, input: confirmation })) } catch { /* server idempotency remains */ }
    setRetryLocked(true)
    try { const result = await api<ShippingRecord>('/api/shipping/orders', { key: key.current, input: confirmation, confirmed: true }); setRecord(result); setConfirmation(null); await refresh() }
    catch (e) {
      if (e instanceof ShippingApiError && e.requestStage === 'validation') {
        // Editing does not allocate a new key; historical uncertain sends remain protected.
        setRetryLocked(false); setConfirmation(null); setSendError(e.message)
      } else {
        setSendError((e as Error).message + ' 请从最近寄件检查原请求；不要重复建立新票。')
      }
      await refresh()
    }
    finally { setSendBusy(false); submitLock.current = false }
  }
  async function reconcile(r: ShippingRecord) {
    setReconcileId(r.id); setRecentError('')
    try { await api<ShippingRecord>(`/api/shipping/orders/${r.id}/reconcile`, {}); await refresh() }
    catch (e) { setRecentError((e as Error).message) }
    finally { setReconcileId('') }
  }
  function nextOrder() {
    key.current = ''; try { sessionStorage.removeItem(storageKey) } catch { /* optional */ }
    setRetryLocked(false); setRecord(null); setConfirmation(null); setSendError(''); setRawAddress(''); setParseNote('已保留上次寄件信息，请核对本次收件人。')
  }
  async function openBook() {
    setBookOpen(true); setBookBusy(true); setBookError('')
    try { const data = await api<{ contacts: SavedShippingContact[] }>('/api/shipping/contacts'); setContacts(data.contacts) } catch (e) { setBookError((e as Error).message) } finally { setBookBusy(false) }
  }
  async function saveSender() {
    const parsed = contactSchema.safeParse(sender)
    if (!parsed.success) { setBookOpen(true); setBookError('请先完整填写并核对寄件人信息。'); return }
    setBookBusy(true); setBookError('')
    try { await api('/api/shipping/contacts', { label: addressLabel.trim() || '常用寄件地址', contact: parsed.data }); await openBook() } catch (e) { setBookError((e as Error).message) } finally { setBookBusy(false) }
  }
  async function copy(number: string) { try { await navigator.clipboard.writeText(number); setCopied(number) } catch { setCopied('复制未完成，请选择单号手动复制') } }
  const locked = sendBusy || retryLocked
  return <div className={styles.workspace}>
    <header className={styles.header}><div><div className={styles.eyebrow}>寄件服务 / SHIPPING</div><h1>自助下单</h1><p>地址粘贴到这里，寄件、查件一屏完成。</p></div><div className={styles.account}><span className={styles.statusDot} />{settings.environment === 'sandbox' ? '沙盒环境' : '顺丰速运'}<small>{settings.monthlyTail ? `月结账号 ···· ${settings.monthlyTail}` : '月结账号待配置'}</small></div></header>
    {settings.environment === 'sandbox' && settings.ready && <div className={styles.notice} role="status">沙盒测试不会实际寄出；物流轨迹由顺丰沙盒模拟。</div>}
    {settings.reason && <div className={styles.notice} role="status"><CircleAlert size={17} />{settings.reason}</div>}
    {settings.guest && <p><a className={styles.textButton} href="/login">登录后寄件</a></p>}
    {settings.defaultsWarning && <div className={styles.notice} role="status">{settings.defaultsWarning}</div>}
    {settings.lastShipment && <p className={styles.subtle}>已带入上次成功寄件信息，请核对本次收件人和物品。</p>}
    <div className={styles.panels}>
      <section className={styles.panel} aria-label="寄件下单"><div className={styles.panelTitle}><h2><Package size={20} />寄件下单</h2><span>单票寄件</span></div><div className={styles.panelBody}>
        {record && <div className={record.status === 'accepted' ? styles.success : styles.notice} role="status"><CheckCircle2 size={20} /><div><strong>{record.status === 'accepted' ? '顺丰已受理，等待取件' : '下单结果待确认，请勿重复寄件'}</strong><p>{record.waybill || '请在右侧最近寄件中确认结果。'}</p>{record.waybill && <button className={styles.textButton} onClick={() => { setWaybill(record.waybill!); void query(record.waybill!) }}>在右侧查询<ArrowUpRight size={14} /></button>}{record.status === 'accepted' && <button className={styles.textButton} onClick={nextOrder}>再寄一票</button>}</div></div>}
        {retryLocked && !record && <div className={styles.notice}>有一笔提交需要确认。请在右侧刷新最近寄件并确认结果后再寄新票。</div>}
        <div className={styles.pasteBox}><label htmlFor="shipping-address"><ClipboardPaste size={17} />粘贴收件信息</label><textarea id="shipping-address" disabled={locked} placeholder="将收到的姓名、电话和完整地址一起粘贴到这里" rows={2} maxLength={2000} value={rawAddress} onChange={e => setRawAddress(e.target.value)} /><div><span>自动整理，可逐项修改</span><button className={styles.textButton} disabled={!rawAddress.trim() || locked} onClick={() => { const result = parseAddress(rawAddress); setRecipient(result.contact); setParseNote(result.warnings.join(' ')); setSendError('') }}>识别并填写<ArrowUpRight size={15} /></button></div>{parseNote && <p className={styles.parseNote} role="status">{parseNote}</p>}</div>
        <form id="shipping-form" onSubmit={prepare}>
        {!settings.guest && <div className={styles.addressActions}><button type="button" className={styles.textButton} disabled={locked || bookBusy} aria-expanded={bookOpen} onClick={() => bookOpen ? setBookOpen(false) : void openBook()}>寄件人地址簿</button><button type="button" className={styles.textButton} disabled={locked || bookBusy} onClick={() => void saveSender()}>保存寄件人到地址簿</button></div>}
        {bookOpen && <section className={styles.addressBook} aria-label="寄件人地址簿"><label className={styles.field}><span>地址名称</span><input aria-label="地址名称" maxLength={40} value={addressLabel} onChange={e => setAddressLabel(e.target.value)} /></label>{bookError && <p className={styles.error} role="alert">{bookError}</p>}{bookBusy ? <p>读取地址簿中…</p> : !contacts.length ? <p className={styles.subtle}>暂无保存的地址。填写寄件人后可保存为常用地址。</p> : contacts.map(c => <button type="button" className={styles.addressItem} key={c.id} onClick={() => { setSender(c.contact); setAddressLabel(c.label); setBookOpen(false) }}><strong>{c.label} · {c.contact.name}</strong><span>{c.contact.phone.slice(0,3)}****{c.contact.phone.slice(-4)} · {c.contact.province}{c.contact.city}{c.contact.county}{c.contact.address}</span></button>)}</section>}
        <ContactFields title="寄件人" mark="寄" value={sender} onChange={setSender} disabled={locked} /><ContactFields title="收件人" mark="收" value={recipient} onChange={setRecipient} disabled={locked} /><fieldset className={styles.contact} disabled={locked}><legend>物品与服务</legend><div className={styles.two}><label className={styles.field}><span>物品名称</span><input aria-label="物品名称" required maxLength={60} value={cargo} onChange={e => setCargo(e.target.value)} /></label><label className={styles.field}><span>预估重量（kg）</span><input aria-label="预估重量" type="number" min="0.01" max="20" step="0.01" required value={weight} onChange={e => setWeight(e.target.value)} /></label></div><label className={styles.field}><span>快递服务</span><select aria-label="快递服务" required value={serviceId} onChange={e => setServiceId(e.target.value)}><option value="">{settings.services.length ? '请选择' : '开通接口后可选择服务'}</option>{settings.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className={styles.field}><span>给快递员捎话</span><input aria-label="寄件备注" maxLength={100} placeholder="如：上门前请先联系" value={remark} onChange={e => setRemark(e.target.value)} /></label><p className={styles.subtle}>单票 1 件 · 寄付月结 · 运费以顺丰实际称重和结算为准</p></fieldset></form>
        {sendError && <p role="alert" className={styles.error}>{sendError}</p>}
        {confirmation && <div className={styles.confirmBox} role="region" aria-label="确认寄件"><h3>请确认本次寄件</h3><p>寄：{confirmation.sender.name} · {confirmation.sender.phone}<br />{confirmation.sender.province}{confirmation.sender.city}{confirmation.sender.county}{confirmation.sender.address}</p><p>收：{confirmation.recipient.name} · {confirmation.recipient.phone}<br />{confirmation.recipient.province}{confirmation.recipient.city}{confirmation.recipient.county}{confirmation.recipient.address}</p><p>{confirmation.cargo} · {confirmation.weight} kg · {settings.services.find(s => s.id === confirmation.serviceId)?.name} · 月结尾号 {settings.monthlyTail}</p><small>确认后将收寄信息发送给顺丰，发起取件请求。</small><div className={styles.confirmButtons}><button type="button" className={styles.secondary} disabled={sendBusy || retryLocked} onClick={() => setConfirmation(null)}>返回修改</button><button type="button" className={styles.primary} disabled={sendBusy} onClick={() => void submit()}>{sendBusy ? '提交中…' : retryLocked ? '重试原请求（不会另建单）' : settings.environment === 'sandbox' ? '确认沙盒下单' : '确认下单'}</button></div></div>}
      </div><footer className={styles.submitFooter}><div><strong>寄付月结</strong><small>{settings.monthlyTail ? `尾号 ${settings.monthlyTail}` : '待配置'}</small></div><button form="shipping-form" type="submit" className={styles.primary} disabled={!settings.canSubmit || locked || !!confirmation}>确认寄件<ArrowUpRight size={17} /></button></footer></section>
      <section className={styles.panel} aria-label="运单查询"><div className={styles.panelTitle}><h2><Search size={20} />运单查询</h2><span>查件</span></div><div className={styles.panelBody}>
        <form className={styles.queryForm} onSubmit={e => { e.preventDefault(); void query() }}><div className={styles.queryRow}><input aria-label="运单号" placeholder="请输入顺丰运单号" value={waybill} maxLength={18} onChange={e => setWaybill(e.target.value)} required /><button className={styles.primary} disabled={queryBusy || !settings.ready}>{queryBusy ? <Loader2 className={styles.spin} size={16} /> : '查询'}</button></div><label className={styles.phoneHint}>手机后四位<input aria-label="手机后四位" placeholder="需要验证时填写" inputMode="numeric" maxLength={4} value={phoneSuffix} onChange={e => setPhoneSuffix(e.target.value.replace(/\D/g, ''))} /><span>收件或寄件任一方</span></label></form>
        {queryError && <p className={styles.error} role="alert">{queryError}</p>}
        {tracking ? <article className={styles.trackResult}><div className={styles.resultHeading}><div><small>顺丰运单</small><strong>{tracking.waybill}</strong></div><button className={styles.iconButton} aria-label="复制查询单号" onClick={() => void copy(tracking.waybill)}><Copy size={16} /></button></div>{tracking.events.length ? <ol className={styles.timeline}>{tracking.events.map((event, i) => <li key={`${event.time}-${i}`}><span className={styles.timelineDot} /><time>{event.time}</time><p>{event.description}</p>{event.location && <small>{event.location}</small>}</li>)}</ol> : <div className={styles.empty}><Package size={42} /><h3>暂无物流轨迹</h3><p>运单可能尚未揽收，稍后可再次查询。</p></div>}<p className={styles.updated}>查询于 {new Date(tracking.queriedAt).toLocaleTimeString('zh-CN')}</p></article> : !queryError && <div className={styles.empty}><Package size={48} strokeWidth={1.2} /><h3>查一下，快件到哪里了</h3><p>输入运单号，或从下方最近寄件中选择。</p></div>}
        <div className={styles.recentHeading}><h3>我寄的 <small>最近 10 票</small></h3><button className={styles.textButton} onClick={() => void refresh()} disabled={recentLoading || settings.guest}><RefreshCw size={14} />刷新</button></div>
        {recentError && <p role="alert" className={styles.error}>{recentError}</p>}
        {recentLoading && !records.length ? <p className={styles.subtle}>正在读取寄件记录…</p> : !records.length && !recentError ? <p className={styles.subtle}>{settings.guest ? '私人寄件记录仅向获授权的账号显示。' : '还没有寄件记录，下单后会显示在这里。'}</p> : records.map(r => <div className={styles.recentRow} key={r.id}><div><strong>{r.waybill || '运单号待确认'}</strong><small>{new Date(r.created_at).toLocaleString('zh-CN')} · {r.status === 'accepted' ? '已受理' : '结果待确认'}</small></div>{r.waybill ? <button className={styles.textButton} onClick={() => { setWaybill(r.waybill!); void query(r.waybill!) }}>查轨迹<ArrowUpRight size={14} /></button> : <button className={styles.textButton} disabled={!!reconcileId} onClick={() => void reconcile(r)}>{reconcileId === r.id ? '确认中…' : '确认结果'}</button>}</div>)}
      </div></section>
    </div>{copied && <div role="status" className={styles.copyNotice}>{copied.startsWith('复制') ? copied : '单号已复制'}</div>}
  </div>
}
