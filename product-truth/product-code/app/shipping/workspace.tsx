"use client"
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Package, Search, ClipboardPaste, ArrowUpRight, Copy, Loader2, CheckCircle2, CircleAlert, RefreshCw, ArrowLeft } from 'lucide-react'
import { parseAddress } from '@/lib/shipping/address'
import { emptyContact, type Contact, type ImportedOutbound, type ShipmentReceipt, type ShippingInput, type ShippingPayment, type ShippingRecord, type ShippingSettings, type TrackingResult } from '@/lib/shipping/types'
import { shippingInputSchema } from '@/lib/shipping/validation'
import styles from './workspace.module.css'
import ContactActions from './contact-actions'
import ShipmentLedger from './ledger'
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
  const [view, setView] = useState<'order' | 'queue' | 'ledger' | 'tracking'>('order')
  const [sender, setSender] = useState<Contact>(settings.lastShipment?.sender || settings.sender), [recipient, setRecipient] = useState<Contact>(settings.lastShipment?.recipient || emptyContact)
  const [payment, setPayment] = useState<ShippingPayment>(settings.guest ? 'sender_monthly' : settings.lastShipment ? settings.lastShipment.payment || 'sender_monthly' : 'sender_cash')
  const paymentLabels = { sender_cash: '寄方现结', recipient: '收方到付', sender_monthly: '寄方月结' }
  const [rawAddress, setRawAddress] = useState(''), [parseNote, setParseNote] = useState('')
  const [cargo, setCargo] = useState(settings.lastShipment?.cargo || '文件'), [weight, setWeight] = useState(String(settings.lastShipment?.weight || 1)), [serviceId, setServiceId] = useState(String(settings.services.some(x => x.id === settings.lastShipment?.serviceId) ? settings.lastShipment?.serviceId : settings.services[0]?.id || '')), [remark, setRemark] = useState(settings.lastShipment?.remark || '')
  const [waybill, setWaybill] = useState(''), [phoneSuffix, setPhoneSuffix] = useState(''), [tracking, setTracking] = useState<TrackingResult | null>(null), [queryBusy, setQueryBusy] = useState(false), [queryError, setQueryError] = useState('')
  const [showTracking, setShowTracking] = useState(false)
  const trackingBody = useRef<HTMLDivElement>(null)
  const listScroll = useRef(0)
  useEffect(() => { if (trackingBody.current) trackingBody.current.scrollTop = showTracking ? 0 : listScroll.current }, [showTracking])
  const [records, setRecords] = useState<ShippingRecord[]>([]), [recentError, setRecentError] = useState(''), [recentLoading, setRecentLoading] = useState(true)
  const [imported, setImported] = useState<ImportedOutbound[]>([])
  const [record, setRecord] = useState<ShippingRecord | null>(null), [sendBusy, setSendBusy] = useState(false), [sendError, setSendError] = useState(''), [confirmation, setConfirmation] = useState<ShippingInput | null>(null)
  const [receipt, setReceipt] = useState<(ShipmentReceipt & { receiptToken?: string }) | null>(null)
  const [copied, setCopied] = useState(''), [reconcileId, setReconcileId] = useState(''), [retryLocked, setRetryLocked] = useState(false)
  const submitLock = useRef(false), key = useRef(''), querySequence = useRef(0)
  const storageKey = `shipping-request:${userId}:${settings.environment}`
  useEffect(() => { if (settings.guest) return; try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); if (saved?.key && shippingInputSchema.safeParse(saved.input).success) { key.current = saved.key; setSender(saved.input.sender); setRecipient(saved.input.recipient); setCargo(saved.input.cargo); setWeight(String(saved.input.weight)); setServiceId(String(saved.input.serviceId)); setRemark(saved.input.remark); setPayment(saved.input.payment || 'sender_monthly'); setConfirmation(saved.input); setRetryLocked(true) } } catch { /* no browser persistence */ } }, [storageKey, settings.guest])
  const refresh = useCallback(async () => { setRecentLoading(true); try { const data = await api<{ records: ShippingRecord[]; imported?: ImportedOutbound[]; current?: ShippingRecord | null }>(`/api/shipping/orders${key.current ? '?key=' + encodeURIComponent(key.current) : ''}`); setRecords(data.records); setImported(data.imported || []); if (data.current) { setRecord(data.current); setConfirmation(null) }; setRecentError('') } catch (e) { setRecentError((e as Error).message) } finally { setRecentLoading(false) } }, [])
  useEffect(() => { if (settings.guest) { setRecentLoading(false); return } void refresh() }, [refresh, settings.guest])
  useEffect(() => { if (!settings.guest) return; const token = new URLSearchParams(window.location.search).get('receipt'); if (!token) return; void api<ShipmentReceipt>(`/api/shipping/public/orders/${encodeURIComponent(token)}`).then(setReceipt).catch(e => setSendError((e as Error).message)) }, [settings.guest])
  async function query(number = waybill) {
    const seq = ++querySequence.current
    if (!showTracking) listScroll.current = trackingBody.current?.scrollTop || 0
    setShowTracking(true); setQueryBusy(true); setQueryError(''); setTracking(null)
    if (trackingBody.current) trackingBody.current.scrollTop = 0
    try { const result = await api<TrackingResult>('/api/shipping/tracking', { waybill: number.trim(), ...(phoneSuffix ? { phoneSuffix } : {}) }); if (seq === querySequence.current) setTracking(result) }
    catch (e) { if (seq === querySequence.current) setQueryError((e as Error).message) }
    finally { if (seq === querySequence.current) setQueryBusy(false) }
  }
  function backToList() {
    ++querySequence.current // A late response must not reopen a detail the user has left.
    setShowTracking(false); setQueryBusy(false); setQueryError(''); setTracking(null)
  }
  function prepare(e: FormEvent) {
    e.preventDefault(); setSendError('')
    const parsed = shippingInputSchema.safeParse({ sender, recipient, cargo, weight: Number(weight), serviceId: Number(serviceId), remark, source: 'manual', payment: settings.guest ? 'sender_monthly' : payment })
    if (!parsed.success) { setSendError(parsed.error.issues.map(i => i.message).join('；')); return }
    setConfirmation(parsed.data)
  }
  async function submit() {
    if (!confirmation || submitLock.current) return
    submitLock.current = true; setSendBusy(true); setSendError('')
    key.current ||= crypto.randomUUID()
    try { sessionStorage.setItem(storageKey, JSON.stringify(settings.guest ? { key: key.current } : { key: key.current, input: confirmation })) } catch { /* server idempotency remains */ }
    setRetryLocked(true)
    try {
      if (settings.guest) {
        const query = new URLSearchParams(window.location.search)
        const result = await api<ShipmentReceipt & { receiptToken: string }>('/api/shipping/public/orders', { key: key.current, rawInput: rawAddress || undefined, input: { ...confirmation, payment: 'sender_monthly' }, contextToken: query.get('context') || undefined, businessCode: query.get('code') || undefined })
        setReceipt(result); setConfirmation(null); window.history.replaceState(null, '', `/shipping?receipt=${encodeURIComponent(result.receiptToken)}`)
      } else {
        const result = await api<ShipmentReceipt>('/api/shipping/owner/orders', { key: key.current, input: confirmation, confirmed: true }); setReceipt(result); setConfirmation(null)
      }
    }
    catch (e) {
      if (e instanceof ShippingApiError && e.requestStage === 'validation') {
        // Editing does not allocate a new key; historical uncertain sends remain protected.
        setRetryLocked(false); setConfirmation(null); setSendError(e.message)
      } else {
        setSendError((e as Error).message + ' 请从最近寄件检查原请求；不要重复建立新票。')
      }
      if (settings.guest) setRetryLocked(false)
      else await refresh()
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
  async function copy(number: string) { try { await navigator.clipboard.writeText(number); setCopied(number) } catch { setCopied('复制未完成，请选择单号手动复制') } }
  const locked = sendBusy || retryLocked
  const canPrepare = settings.guest ? settings.services.length > 0 : settings.canSubmit
  const activeConnection = settings.carrierConnections?.find(connection => connection.id === settings.connectionId)
  const productionOrderUnverified = !settings.guest && activeConnection?.environment === 'production' && activeConnection.orderCapability === 'not_tested'
  return <div className={styles.workspace}>
    <header className={styles.header}><div><div className={styles.eyebrow}>寄件协同 / SHIPPING</div><h1>{settings.guest ? '寄件登记' : '寄件处理台'}</h1><p>{settings.guest ? '粘贴地址，确认后提交寄件登记。' : '处理本人寄件与业务待核对寄件单。'}</p></div><div className={styles.account}><span className={styles.statusDot} />{settings.guest ? '匿名访问' : settings.environment === 'sandbox' ? '沙盒环境' : '承运商已连接'}<small>{settings.guest ? '无需登录 · 单票安全回执' : settings.monthlyTail ? `月结账号 ···· ${settings.monthlyTail}` : '月结账号待配置'}</small></div></header>
    {settings.environment === 'sandbox' && settings.ready && <div className={styles.notice} role="status">沙盒测试不会实际寄出；物流轨迹由顺丰沙盒模拟。</div>}
    {settings.reason && <div className={styles.notice} role="status"><CircleAlert size={17} />{settings.reason}</div>}
    {settings.guest && <p><a className={styles.textButton} href="/login">用户后台登录</a></p>}
    {settings.defaultsWarning && <div className={styles.notice} role="status">{settings.defaultsWarning}</div>}
    {settings.lastShipment && <p className={styles.subtle}>已带入上次成功寄件信息，请核对本次收件人和物品。</p>}
    {!settings.guest && <nav className={styles.tabs} aria-label="寄件协同功能"><button className={view === 'order' ? styles.activeTab : ''} onClick={() => setView('order')}>本人寄件</button><button className={view === 'queue' ? styles.activeTab : ''} onClick={() => setView('queue')}>业务待核对</button><button className={view === 'ledger' ? styles.activeTab : ''} onClick={() => setView('ledger')}>收寄件台账</button><button className={view === 'tracking' ? styles.activeTab : ''} onClick={() => setView('tracking')}>物流跟踪</button></nav>}
    {receipt && <div className={styles.success} role="status"><CheckCircle2 size={20} /><div><strong>{settings.guest ? '下单成功 · 平台已受理' : receipt.status === 'waybill_created' ? '运单已生成' : '下单结果待确认'}</strong><p>寄件单号：{receipt.orderNo}</p><p>{receipt.waybill ? `运单号：${receipt.waybill}` : `尚未生成运单${receipt.nextReviewAt ? ` · 预计 ${new Date(receipt.nextReviewAt).toLocaleString('zh-CN')} 处理` : ''}`}</p>{receipt.receiptToken && <a className={styles.textButton} href={`/shipping?receipt=${encodeURIComponent(receipt.receiptToken)}`}>查看本单查询链接</a>}</div></div>}
    <div className={`${styles.panels} ${styles.singlePanel}`}>
      {(settings.guest || view === 'order') && <section className={styles.panel} aria-label={settings.guest ? '寄件登记' : '本人寄件'}><div className={styles.panelTitle}><h2><Package size={20} />{settings.guest ? '寄件登记' : '本人寄件'}</h2><span>{settings.guest ? '匿名提交' : '直接下单'}</span></div><div className={styles.panelBody}>
        {record && <div className={record.status === 'accepted' ? styles.success : styles.notice} role="status"><CheckCircle2 size={20} /><div><strong>{record.status === 'accepted' ? '顺丰已受理，等待取件' : '下单结果待确认，请勿重复寄件'}</strong><p>{record.waybill || '请在右侧最近寄件中确认结果。'}</p>{record.waybill && <button className={styles.textButton} onClick={() => { setWaybill(record.waybill!); void query(record.waybill!) }}>在右侧查询<ArrowUpRight size={14} /></button>}{record.status === 'accepted' && <button className={styles.textButton} onClick={nextOrder}>再寄一票</button>}</div></div>}
        {retryLocked && !record && <div className={styles.notice}>有一笔提交需要确认。请在右侧刷新最近寄件并确认结果后再寄新票。</div>}
        <div className={styles.pasteBox}><label htmlFor="shipping-address"><ClipboardPaste size={17} />粘贴收件信息</label><textarea id="shipping-address" disabled={locked} placeholder="将收到的姓名、电话和完整地址一起粘贴到这里" rows={2} maxLength={2000} value={rawAddress} onChange={e => setRawAddress(e.target.value)} /><div><span>自动整理，可逐项修改</span><button className={styles.textButton} disabled={!rawAddress.trim() || locked} onClick={() => { const result = parseAddress(rawAddress); setRecipient(result.contact); setParseNote(result.warnings.join(' ')); setSendError('') }}>识别并填写<ArrowUpRight size={15} /></button></div>{parseNote && <p className={styles.parseNote} role="status">{parseNote}</p>}</div>
        <form id="shipping-form" onSubmit={prepare}>
        <ContactActions kind="sender" value={sender} onChange={setSender} disabled={locked} guest={settings.guest} />
        <ContactFields title="寄件人" mark="寄" value={sender} onChange={setSender} disabled={locked} />
        <ContactActions kind="recipient" value={recipient} onChange={setRecipient} disabled={locked} guest={settings.guest} />
        <ContactFields title="收件人" mark="收" value={recipient} onChange={setRecipient} disabled={locked} /><fieldset className={styles.contact} disabled={locked}><legend>物品与服务</legend>{settings.guest ? <p className={styles.subtle}>付款方式：企业统一结算，提交后等待处理。</p> : <label className={styles.field}><span>付款方式</span><select aria-label="付款方式" value={payment} onChange={e => setPayment(e.target.value as ShippingPayment)}><option value="sender_cash">寄方现结</option><option value="recipient">收方到付</option><option value="sender_monthly">寄方月结</option></select></label>}<div className={styles.two}><label className={styles.field}><span>物品名称</span><input aria-label="物品名称" required maxLength={60} value={cargo} onChange={e => setCargo(e.target.value)} /></label><label className={styles.field}><span>预估重量（kg）</span><input aria-label="预估重量" type="number" min="0.01" max="20" step="0.01" required value={weight} onChange={e => setWeight(e.target.value)} /></label></div><label className={styles.field}><span>快递服务</span><select aria-label="快递服务" required value={serviceId} onChange={e => setServiceId(e.target.value)}><option value="">{settings.services.length ? '请选择' : '服务暂不可选'}</option>{settings.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className={styles.field}><span>寄件备注</span><input aria-label="寄件备注" maxLength={100} placeholder="如：上门前请先联系" value={remark} onChange={e => setRemark(e.target.value)} /></label><p className={styles.subtle}>单票 1 件 · {settings.guest ? '企业统一结算' : paymentLabels[payment]} · 运费以承运商实际称重和结算为准</p></fieldset></form>
        {sendError && <p role="alert" className={styles.error}>{sendError}</p>}
        {confirmation && <div className={styles.confirmBox} role="region" aria-label="确认寄件"><h3>请确认本次寄件</h3><p>寄：{confirmation.sender.name} · {confirmation.sender.phone}<br />{confirmation.sender.province}{confirmation.sender.city}{confirmation.sender.county}{confirmation.sender.address}</p><p>收：{confirmation.recipient.name} · {confirmation.recipient.phone}<br />{confirmation.recipient.province}{confirmation.recipient.city}{confirmation.recipient.county}{confirmation.recipient.address}</p><p>{confirmation.cargo} · {confirmation.weight} kg · {settings.services.find(s => s.id === confirmation.serviceId)?.name} · {settings.guest ? '企业统一结算' : paymentLabels[confirmation.payment || 'sender_monthly']}</p><small>{settings.guest ? '确认后提交寄件登记，尚不会直接生成承运商运单。' : productionOrderUnverified ? '这是首笔生产实测；确认后会向顺丰真实下单并按月结账号结算，运费以顺丰实际结算为准。' : '确认后将向承运商提交真实订单。'}</small><div className={styles.confirmButtons}><button type="button" className={styles.secondary} disabled={sendBusy || retryLocked} onClick={() => setConfirmation(null)}>返回修改</button><button type="button" className={styles.primary} disabled={sendBusy} onClick={() => void submit()}>{sendBusy ? '提交中…' : settings.guest ? '确认提交' : retryLocked ? '重试原请求（不会另建单）' : settings.environment === 'sandbox' ? '确认沙盒下单' : '确认下单'}</button></div></div>}
      </div><footer className={styles.submitFooter}><div><strong>{settings.guest ? '企业统一结算' : paymentLabels[payment]}</strong><small>{settings.guest ? '提交后获得安全回执' : payment === 'sender_monthly' ? settings.monthlyTail ? `尾号 ${settings.monthlyTail}` : '月结待配置' : payment === 'recipient' ? '收件客户支付运费' : '寄件人支付运费'}</small></div><button form="shipping-form" type="submit" className={styles.primary} disabled={!canPrepare || locked || !!confirmation || !!receipt}>{settings.guest ? '提交寄件登记' : '确认寄件'}<ArrowUpRight size={17} /></button></footer></section>}
      {!settings.guest && view === 'tracking' && <section className={styles.panel} aria-label="运单查询"><div className={styles.panelTitle}><h2><Search size={20} />物流跟踪</h2><span>{showTracking ? '物流详情' : '查件'}</span></div>{showTracking && <div className={styles.panelTitle}><button type="button" className={styles.textButton} onClick={backToList}><ArrowLeft size={16} />返回寄件列表</button><span role="status">{queryBusy ? '正在查询物流…' : ''}</span></div>}<div className={styles.panelBody} ref={trackingBody}>
        <form className={styles.queryForm} onSubmit={e => { e.preventDefault(); void query() }}><div className={styles.queryRow}><input aria-label="运单号" placeholder="请输入顺丰运单号" value={waybill} maxLength={18} onChange={e => setWaybill(e.target.value)} required /><button className={styles.primary} disabled={queryBusy || !settings.ready}>{queryBusy ? <><Loader2 className={styles.spin} size={16} />查询中…</> : '查询'}</button></div><label className={styles.phoneHint}>手机后四位<input aria-label="手机后四位" placeholder="需要验证时填写" inputMode="numeric" maxLength={4} value={phoneSuffix} onChange={e => setPhoneSuffix(e.target.value.replace(/\D/g, ''))} /><span>收件或寄件任一方</span></label></form>
        {queryError && <p className={styles.error} role="alert">{queryError}</p>}
        {showTracking && queryBusy && <p role="status" className={styles.subtle}>正在获取 {waybill} 的最新物流，请稍候…</p>}
        {showTracking && tracking ? <article className={styles.trackResult}><div className={styles.resultHeading}><div><small>顺丰运单</small><strong>{tracking.waybill}</strong></div><button className={styles.iconButton} aria-label="复制查询单号" onClick={() => void copy(tracking.waybill)}><Copy size={16} /></button></div>{tracking.events.length ? <ol className={styles.timeline}>{tracking.events.map((event, i) => <li key={`${event.time}-${i}`}><span className={styles.timelineDot} /><time>{event.time}</time><p>{event.description}</p>{event.location && <small>{event.location}</small>}</li>)}</ol> : <div className={styles.empty}><Package size={42} /><h3>暂无物流轨迹</h3><p>运单可能尚未揽收，稍后可再次查询。</p></div>}<p className={styles.updated}>查询于 {new Date(tracking.queriedAt).toLocaleTimeString('zh-CN')}</p></article> : !showTracking && <div className={styles.empty}><Package size={48} strokeWidth={1.2} /><h3>查一下，快件到哪里了</h3><p>输入运单号，或从下方最近寄件中选择。</p></div>}
        {!showTracking && <>
        <div className={styles.recentHeading}><h3>我寄的 <small>{imported.length ? `含 ${imported.length} 票历史记录` : '最近 10 票'}</small></h3><button className={styles.textButton} onClick={() => void refresh()} disabled={recentLoading || settings.guest}><RefreshCw size={14} />刷新</button></div>
        {imported.length > 0 && <section aria-label="本人历史寄件"><p className={styles.subtle}>从本人顺丰账号导入，列表状态为导入时快照；点击“查轨迹”获取最新物流。</p>{imported.map(r => <div className={styles.recentRow} key={r.id}><div><strong>{r.waybill}</strong><small>{r.source_time} · {r.source_status}</small></div><div className={styles.addressActions}><button type="button" className={styles.textButton} aria-label={`复制 ${r.waybill}`} onClick={() => void copy(r.waybill)}>复制</button><button type="button" className={styles.textButton} onClick={() => { setWaybill(r.waybill); void query(r.waybill) }}>查轨迹<ArrowUpRight size={14} /></button></div></div>)}</section>}
        {recentError && <p role="alert" className={styles.error}>{recentError}</p>}
        {recentLoading && !records.length ? <p className={styles.subtle}>正在读取寄件记录…</p> : !records.length && !recentError && !imported.length ? <p className={styles.subtle}>{settings.guest ? '私人寄件记录仅向获授权的账号显示。' : '还没有寄件记录，下单后会显示在这里。'}</p> : records.map(r => <div className={styles.recentRow} key={r.id}><div><strong>{r.waybill || '运单号待确认'}</strong><small>{new Date(r.created_at).toLocaleString('zh-CN')} · {r.status === 'accepted' ? '已受理' : '结果待确认'}</small></div>{r.waybill ? <button className={styles.textButton} onClick={() => { setWaybill(r.waybill!); void query(r.waybill!) }}>查轨迹<ArrowUpRight size={14} /></button> : <button className={styles.textButton} disabled={!!reconcileId} onClick={() => void reconcile(r)}>{reconcileId === r.id ? '确认中…' : '确认结果'}</button>}</div>)}
        </>}
      </div></section>}
      {!settings.guest && (view === 'queue' || view === 'ledger') && <ShipmentLedger queueOnly={view === 'queue'} onTrack={number => { setWaybill(number); setView('tracking'); void query(number) }} />}
    </div>{copied && <div role="status" className={styles.copyNotice}>{copied.startsWith('复制') ? copied : '单号已复制'}</div>}
  </div>
}
