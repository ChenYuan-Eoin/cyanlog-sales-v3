'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, LoaderCircle, Plus, Settings, ShieldCheck, X } from 'lucide-react'
import type { ShippingConfiguration } from '@/lib/shipping/connections'
import { emptyContact, type Contact } from '@/lib/shipping/types'
import styles from './config-drawer.module.css'

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch('/api/shipping/settings', { ...init, cache: 'no-store', headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '配置暂未保存')
  return data as T
}

type ConfigurationReply = { configuration: ShippingConfiguration }

export default function ShippingConfigDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [configuration, setConfiguration] = useState<ShippingConfiguration>({ connections: [], billingAccounts: [], sender: null })
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox')
  const [partnerId, setPartnerId] = useState('')
  const [checkWord, setCheckWord] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('公司月结账号')
  const [accountEnvironment, setAccountEnvironment] = useState<'sandbox' | 'production'>('sandbox')
  const [accountDefault, setAccountDefault] = useState(false)
  const [senderName, setSenderName] = useState('公司默认寄件地址')
  const [sender, setSender] = useState<Contact>(emptyContact())
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [probeMessage, setProbeMessage] = useState('')
  const [probePassed, setProbePassed] = useState(false)

  async function refresh() {
    const data = await request<ConfigurationReply>()
    setConfiguration(data.configuration)
    const savedSender = data.configuration.sender
    if (savedSender) {
      setSenderName(savedSender.displayName)
      setSender({ name: savedSender.name, phone: savedSender.phone, province: savedSender.province, city: savedSender.city, county: savedSender.county, address: savedSender.address })
    }
  }

  useEffect(() => { if (open) { setMessage(''); void refresh().catch(error => setMessage((error as Error).message)) } }, [open])

  async function mutate(label: string, action: string, values: Record<string, unknown> = {}) {
    setBusy(label); setMessage('')
    try {
      const data = await request<ConfigurationReply>({ method: 'POST', body: JSON.stringify({ action, ...values }) })
      setConfiguration(data.configuration)
      setMessage('配置已保存。')
      return true
    } catch (error) { setMessage((error as Error).message); return false } finally { setBusy('') }
  }

  async function saveConnection() {
    if (!partnerId.trim() || !checkWord.trim()) { setMessage('请填写PartnerID和CheckWord。'); return }
    setProbeMessage(''); setProbePassed(false)
    const saved = await mutate('connection', 'save_connection', { environment, partnerId, checkWord })
    if (saved) { setPartnerId(''); setCheckWord('') }
  }

  async function testConnection() {
    setBusy('probe'); setProbeMessage('正在请求顺丰沙盒…'); setProbePassed(false); setMessage('')
    try {
      const response = await request<{ configuration: ShippingConfiguration; probe: { connected: boolean; message: string } }>({ method: 'POST', body: JSON.stringify({ action: 'test_sandbox_connection' }) })
      setConfiguration(response.configuration); setProbeMessage(response.probe.message); setProbePassed(response.probe.connected)
    } catch (error) { setProbeMessage((error as Error).message) } finally { setBusy('') }
  }

  async function saveAccount() {
    if (!accountNumber.trim()) { setMessage('请输入月结卡号。'); return }
    const saved = await mutate('account', 'add_billing_account', { accountNumber, displayName: accountName, environment: accountEnvironment, isDefault: accountDefault })
    if (saved) { setAccountNumber(''); setAccountDefault(false) }
  }

  async function saveSenderProfile() {
    await mutate('sender', 'save_sender', { displayName: senderName, contact: sender })
  }

  if (!open) return null
  const connection = configuration.connections.find(item => item.carrier === 'sf' && item.environment === environment)
  return <div className={styles.backdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="shipping-config-title">
      <header className={styles.header}><div><p>SHIPPING SETTINGS</p><h2 id="shipping-config-title">寄件配置</h2></div><button className={styles.close} aria-label="关闭寄件配置" onClick={onClose}><X size={18}/></button></header>
      <div className={styles.content}>
        <section className={styles.section}>
          <div className={styles.sectionTitle}><div><ShieldCheck size={16}/><h3>顺丰机器连接</h3></div><span>{connection ? `尾号 ${connection.partnerIdTail}` : '尚未配置'}</span></div>
          <p className={styles.hint}>PartnerID与CheckWord经服务端加密保存，读取时不会返回CheckWord。人员不需要登录顺丰。</p>
          <label>运行环境<select value={environment} onChange={event => setEnvironment(event.target.value as typeof environment)}><option value="sandbox">沙盒</option><option value="production">生产</option></select></label>
          {connection && <div className={styles.savedState}>已保存 · {connection.status === 'connected' ? '沙盒连接通过' : connection.status === 'failed' ? '最近连接检查失败' : '待连接检查'} · 查询能力 {connection.capabilities.query === 'verified' ? '已验证' : '未验证'}</div>}
          {connection && <div className={styles.capabilities} aria-label="顺丰能力验证状态">{([['order', '下单'], ['query', '订单查询'], ['tracking', '轨迹'], ['cancel', '取消']] as const).map(([key, label]) => <div key={key}><span>{label}</span><b>{connection.capabilities[key] === 'verified' ? '已验证' : connection.capabilities[key] === 'unavailable' ? '不可用' : '未验证'}</b></div>)}</div>}
          <label>PartnerID<input autoComplete="off" value={partnerId} onChange={event => setPartnerId(event.target.value)} placeholder={connection ? '重新输入以轮换凭据' : '顺丰分配的PartnerID'}/></label>
          <label>CheckWord<input autoComplete="new-password" type="password" value={checkWord} onChange={event => setCheckWord(event.target.value)} placeholder="只用于签名，不会再次显示"/></label>
          <div className={styles.actions}><button disabled={!!busy} onClick={() => void saveConnection()}>{busy === 'connection' ? '保存中…' : '保存连接'}</button><button className={styles.secondary} disabled={!!busy || !configuration.connections.some(item => item.environment === 'sandbox')} onClick={() => void testConnection()}>{busy === 'probe' ? <><LoaderCircle size={14}/>测试中…</> : '测试沙盒连接'}</button></div>
          {probeMessage && <p className={`${styles.probe} ${probePassed ? styles.success : styles.failure}`} role="status">{probePassed && <CheckCircle2 size={14}/>} {probeMessage}</p>}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}><div><Settings size={16}/><h3>月结账号</h3></div><span>账号仅显示尾号</span></div>
          <div className={styles.accountList}>{configuration.billingAccounts.map(account => <article key={account.id} className={styles.account}><div><strong>{account.displayName}</strong><small>{account.environment === 'sandbox' ? '沙盒' : '生产'} · 尾号 {account.tail} · {account.status === 'active' ? '可用' : '已停用'}{account.isDefault ? ' · 默认' : ''}</small></div><div className={styles.accountActions}>{account.status === 'active' && !account.isDefault && <button className={styles.textAction} disabled={!!busy} onClick={() => void mutate(`default-${account.id}`, 'set_default_account', { accountId: account.id })}>设默认</button>}{account.status === 'active' && <button className={styles.textAction} disabled={!!busy} onClick={() => void mutate(`disable-${account.id}`, 'deactivate_account', { accountId: account.id })}>停用</button>}</div></article>)}</div>
          <label>绑定环境<select value={accountEnvironment} onChange={event => setAccountEnvironment(event.target.value as typeof accountEnvironment)}><option value="sandbox">沙盒</option><option value="production">生产</option></select></label>
          <label>月结卡号<input autoComplete="off" inputMode="numeric" value={accountNumber} onChange={event => setAccountNumber(event.target.value.replace(/\D/g, '').slice(0, 32))} placeholder="输入完整月结卡号"/></label>
          <label>显示名称<input value={accountName} onChange={event => setAccountName(event.target.value)} maxLength={80}/></label>
          <label className={styles.checkbox}><input type="checkbox" checked={accountDefault} onChange={event => setAccountDefault(event.target.checked)}/>设为该连接的默认账号</label>
          <button className={styles.secondary} disabled={!!busy} onClick={() => void saveAccount()}>{busy === 'account' ? '保存中…' : <><Plus size={14}/>绑定月结账号</>}</button>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}><div><Settings size={16}/><h3>公司默认寄件人</h3></div></div>
          <label>资料名称<input value={senderName} onChange={event => setSenderName(event.target.value)} maxLength={80}/></label>
          <div className={styles.twoColumns}><label>姓名<input value={sender.name} onChange={event => setSender(value => ({ ...value, name: event.target.value }))}/></label><label>电话<input value={sender.phone} onChange={event => setSender(value => ({ ...value, phone: event.target.value }))}/></label></div>
          <div className={styles.threeColumns}><label>省<input value={sender.province} onChange={event => setSender(value => ({ ...value, province: event.target.value }))}/></label><label>市<input value={sender.city} onChange={event => setSender(value => ({ ...value, city: event.target.value }))}/></label><label>区县<input value={sender.county} onChange={event => setSender(value => ({ ...value, county: event.target.value }))}/></label></div>
          <label>详细地址<input value={sender.address} onChange={event => setSender(value => ({ ...value, address: event.target.value }))}/></label>
          <button disabled={!!busy} onClick={() => void saveSenderProfile()}>{busy === 'sender' ? '保存中…' : '保存寄件人信息'}</button>
        </section>
        {message && <p className={styles.message} role="status">{message}</p>}
        <p className={styles.footerNote}>连接检查只验证顺丰沙盒的只读签名请求，不创建运单，也不代表下单、轨迹、取消权限已开通。</p>
      </div>
    </aside>
  </div>
}
