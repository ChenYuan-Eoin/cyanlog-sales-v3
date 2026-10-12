'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, LoaderCircle, Plus, Settings, ShieldCheck, X } from 'lucide-react'
import type { ShippingConfiguration } from '@/lib/shipping/connections'
import { emptyContact, type Contact } from '@/lib/shipping/types'
import styles from './config-drawer.module.css'
import { parseAddress } from '@/lib/shipping/address'
import IntakeConfiguration from './intake-configuration'
import WecomConfiguration from './wecom-configuration'
import { SF_SERVICE_CATALOG, DEFAULT_INTAKE_SERVICES } from '@/lib/shipping/sf-service-catalog'

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch('/api/shipping/settings', { ...init, cache: 'no-store', headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '配置暂未保存')
  return data as T
}

type ConfigurationReply = {
  configuration?: ShippingConfiguration
  navigationAvailable?: boolean
  operatorAccess?: OperatorAccess
  legacyConfigurationAvailable?: Record<'sandbox' | 'production', boolean>
  imported?: string[]
  needsAttention?: string[]
  importedCount?: number
}
type OperatorAccess = {
  operators: Array<{ id: string; name: string; enabled: boolean; canOperate: boolean; grantSource: 'database' | 'legacy' | 'none' }>
  legacyImportAvailable: boolean
  legacyImportCompleted: boolean
}

export default function ShippingConfigDrawer({ open = true, onClose, embedded = false }: { open?: boolean; onClose?: () => void; embedded?: boolean }) {
  const [configuration, setConfiguration] = useState<ShippingConfiguration>({ connections: [], billingAccounts: [], sender: null })
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('production')
  const [partnerId, setPartnerId] = useState('')
  const [checkWord, setCheckWord] = useState('')
  const [authorizedServices, setAuthorizedServices] = useState<Array<{ id: number; name: string; preference: 'standard' | 'urgent' }>>([])
  const [newServiceId, setNewServiceId] = useState('')
  const [newServiceName, setNewServiceName] = useState('')
  const [newServicePreference, setNewServicePreference] = useState<'standard' | 'urgent'>('standard')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [senderName, setSenderName] = useState('公司默认寄件地址')
  const [senderText, setSenderText] = useState('')
  const [sender, setSender] = useState<Contact>(emptyContact())
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [probeMessage, setProbeMessage] = useState('')
  const [probePassed, setProbePassed] = useState(false)
  const [accessState, setAccessState] = useState<'checking' | 'ready' | 'unavailable'>('checking')
  const [operatorAccess, setOperatorAccess] = useState<OperatorAccess | null>(null)
  const [operatorDraft, setOperatorDraft] = useState<string[]>([])
  const [operatorBusy, setOperatorBusy] = useState(false)
  const [operatorMessage, setOperatorMessage] = useState('')
  const [legacyConfigurationAvailable, setLegacyConfigurationAvailable] = useState<Record<'sandbox' | 'production', boolean>>({ sandbox: false, production: false })
  const [legacyMigrationReport, setLegacyMigrationReport] = useState<{ imported: string[]; needsAttention: string[] } | null>(null)

  async function refresh() {
    const data = await request<ConfigurationReply>()
    if (!data.configuration) {
      setAccessState('unavailable')
      setMessage(data.navigationAvailable
        ? '当前账号可以办理寄件，但没有寄件配置管理权限。'
        : '寄件配置暂不可用，请检查账号权限后重试。')
      return
    }
    setConfiguration(data.configuration)
    if (data.legacyConfigurationAvailable) setLegacyConfigurationAvailable(data.legacyConfigurationAvailable)
    if (data.operatorAccess) {
      setOperatorAccess(data.operatorAccess)
      setOperatorDraft(data.operatorAccess.operators.filter(item => item.canOperate).map(item => item.id))
    }
    const savedSender = data.configuration.sender
    if (savedSender) {
      setSenderName(savedSender.displayName)
      setSender({ name: savedSender.name, phone: savedSender.phone, province: savedSender.province, city: savedSender.city, county: savedSender.county, address: savedSender.address })
    }
    setAccessState('ready')
  }

  useEffect(() => { if (open || embedded) { setAccessState('checking'); setMessage(''); void refresh().catch(error => { setAccessState('unavailable'); setMessage((error as Error).message) }) } }, [open, embedded])
  useEffect(() => {
    const saved = configuration.connections.find(item => item.carrier === 'sf' && item.environment === environment)
    setAuthorizedServices(saved?.services?.length ? saved.services : DEFAULT_INTAKE_SERVICES.map(({ id, name, preference }) => ({ id, name, preference })))
  }, [environment, configuration.connections])

  async function mutate(label: string, action: string, values: Record<string, unknown> = {}) {
    setBusy(label); setMessage('')
    try {
      const data = await request<ConfigurationReply>({ method: 'POST', body: JSON.stringify({ action, ...values }) })
      if (data.configuration) setConfiguration(data.configuration)
      if (data.operatorAccess) {
        setOperatorAccess(data.operatorAccess)
        setOperatorDraft(data.operatorAccess.operators.filter(item => item.canOperate).map(item => item.id))
      }
      if (data.legacyConfigurationAvailable) setLegacyConfigurationAvailable(data.legacyConfigurationAvailable)
      if (data.imported || data.needsAttention) setLegacyMigrationReport({ imported: data.imported || [], needsAttention: data.needsAttention || [] })
      if (!data.configuration && !data.operatorAccess) throw new Error('配置更新成功，但服务器未返回最新配置。请刷新后检查。')
      setMessage(`${label === 'connection' ? '顺丰连接' : label === 'services' ? '可提报服务' : label === 'account' ? '月结账号' : label === 'sender' ? '默认寄件资料' : '配置'}已保存。`)
      return data
    } catch (error) { setMessage((error as Error).message); return null } finally { setBusy('') }
  }

  async function saveConnection() {
    if (!partnerId.trim() || !checkWord.trim()) { setMessage('请展开“首次接入 / 更换应用凭据”，填写应用编号和应用密钥。'); return }
    setProbeMessage(''); setProbePassed(false)
    const saved = await mutate('connection', 'save_connection', { environment, partnerId, checkWord, services: authorizedServices })
    if (saved) { setPartnerId(''); setCheckWord('') }
  }

  async function saveAuthorizedServices() {
    if (!connection) { setMessage('请先保存当前环境的顺丰连接。'); return }
    if (!authorizedServices.length) { setMessage('请至少添加一项顺丰服务产品。'); return }
    await mutate('services', 'save_authorized_services', { environment, services: authorizedServices })
  }

  function addService() {
    const id = Number(newServiceId)
    const name = newServiceName.trim()
    if (!Number.isInteger(id) || id < 1 || !name) { setMessage('请输入有效的顺丰服务编号和名称。'); return }
    if (authorizedServices.some(service => service.id === id)) { setMessage('该服务编号已在列表中。'); return }
    setAuthorizedServices(current => [...current, { id, name, preference: newServicePreference }])
    setNewServiceId(''); setNewServiceName(''); setMessage('')
  }

  async function testConnection() {
    const selectedEnvironment = environment
    setBusy('probe'); setProbeMessage(`正在请求顺丰${selectedEnvironment === 'sandbox' ? '沙盒' : '生产'}只读接口…`); setProbePassed(false); setMessage('')
    try {
      const response = await request<{ configuration: ShippingConfiguration; probe: { connected: boolean; queryVerified: boolean; message: string } }>({ method: 'POST', body: JSON.stringify({ action: selectedEnvironment === 'sandbox' ? 'test_sandbox_connection' : 'test_production_connection' }) })
      setConfiguration(response.configuration); setProbeMessage(response.probe.message); setProbePassed(response.probe.connected)
    } catch (error) { setProbeMessage((error as Error).message) } finally { setBusy('') }
  }

  async function importLegacyConfiguration() {
    setLegacyMigrationReport(null)
    await mutate('legacy-import', 'import_legacy_configuration', { environment })
  }

  async function saveAccount() {
    if (!accountNumber.trim()) { setMessage('请输入月结卡号。'); return }
    const saved = await mutate('account', 'add_billing_account', { accountNumber, displayName: accountName, environment })
    if (saved) { setAccountNumber('') }
  }

  async function saveSenderProfile() {
    await mutate('sender', 'save_sender', { displayName: senderName, contact: sender })
  }

  async function saveOperatorAccess() {
    if (!operatorAccess || operatorAccess.legacyImportAvailable) return
    setOperatorBusy(true); setOperatorMessage('')
    try {
      const response = await mutate('operators', 'save_operator_access', { userIds: operatorDraft })
      if (!response?.operatorAccess) return
      setOperatorMessage('寄件操作权限已保存。')
    } finally { setOperatorBusy(false) }
  }

  async function importLegacyOperatorAccess() {
    setOperatorBusy(true); setOperatorMessage('')
    try {
      const response = await mutate('operators', 'import_legacy_operator_access')
      if (!response?.operatorAccess) return
      setOperatorMessage(`已将当前环境中原有的 ${response.importedCount || 0} 个寄件授权迁入组织权限。`)
    } finally { setOperatorBusy(false) }
  }

  if (!open && !embedded) return null
  if (accessState !== 'ready') {
    const content = accessState === 'checking' ? '正在检查寄件配置权限…' : message || '寄件配置暂不可用。'
    return <section className={embedded ? styles.accessState : styles.backdrop} role={embedded ? 'region' : 'dialog'} aria-labelledby="shipping-config-access-title">
      <div className={embedded ? styles.accessCard : styles.accessDialog}>
        <h2 id="shipping-config-access-title">{accessState === 'checking' ? '正在检查权限' : '寄件配置不可用'}</h2>
        <p role="status">{content}</p>
        {accessState === 'unavailable' && <a href="/shipping">返回自助收寄工作台</a>}
      </div>
    </section>
  }
  const connection = configuration.connections.find(item => item.carrier === 'sf' && item.environment === environment)
  const hasSandboxConnection = configuration.connections.some(item => item.carrier === 'sf' && item.environment === 'sandbox')
  return <div className={embedded ? styles.embedded : styles.backdrop} role={embedded ? 'region' : 'presentation'} onMouseDown={event => { if (!embedded && event.target === event.currentTarget) onClose?.() }}>
    <aside className={styles.drawer} role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : true} aria-labelledby="shipping-config-title">
      <header className={styles.header}><div><p>SHIPPING SETTINGS</p><h2 id="shipping-config-title">寄件设置</h2></div>{!embedded && <button className={styles.close} aria-label="关闭寄件配置" onClick={onClose}><X size={18}/></button>}</header>
      {message && <p className={`${styles.message} ${styles.feedback}`} role="status" aria-live="polite">{message}</p>}
      <div className={styles.content}>
        <IntakeConfiguration/>
        <WecomConfiguration onMessage={setMessage}/>
        <section className={styles.section}>
          <div className={styles.sectionTitle}><div><ShieldCheck size={16}/><h3>顺丰 API 接入</h3></div><span>{connection ? `尾号 ${connection.partnerIdTail}` : '尚未配置'}</span></div>
          <p className={styles.hint}>只需配置一次应用编号和密钥，系统自动获取和刷新接口令牌，无需定期登录顺丰官网。已有服务器配置可直接迁入。</p>
          <label>承运商<select value="sf" disabled><option value="sf">顺丰速运</option></select></label><p className={styles.hint}>当前支持顺丰接口。月结号可先保存，接口凭据用于后续正式下单。</p><label>运行环境<select value={environment} onChange={event => setEnvironment(event.target.value as typeof environment)}><option value="sandbox">沙盒</option><option value="production">生产</option></select></label>
          {connection && <div className={styles.savedState}>已保存 · {connection.status === 'connected' ? `${connection.environment === 'sandbox' ? '沙盒' : '生产'}连接通过` : connection.status === 'failed' ? '最近连接检查失败' : '待连接检查'} · 只读查询能力 {connection.capabilities.query === 'verified' ? '已验证' : '未验证'}</div>}
          {connection && <div className={styles.capabilities} aria-label="顺丰能力验证状态">{([['order', '下单'], ['query', '订单查询'], ['tracking', '轨迹'], ['cancel', '取消']] as const).map(([key, label]) => <div key={key}><span>{label}</span><b>{connection.capabilities[key] === 'verified' ? '已验证' : connection.capabilities[key] === 'unavailable' ? '不可用' : '未验证'}</b></div>)}</div>}
          <details><summary>首次接入 / 更换应用凭据</summary><label>应用编号<input autoComplete="off" value={partnerId} onChange={event => setPartnerId(event.target.value)} placeholder={connection ? '重新输入以轮换凭据' : '顺丰分配的PartnerID'}/></label>
          <label>应用密钥<input autoComplete="new-password" type="password" value={checkWord} onChange={event => setCheckWord(event.target.value)} placeholder="只用于服务端认证，不会再次显示"/></label></details>
          <div className={styles.serviceHeading}><strong>允许提报的顺丰服务产品</strong><span>实际承运仍以顺丰接口返回为准</span></div>
          <div className={styles.services}>{authorizedServices.map((service, index) => <div key={service.id}><span>{service.name}{index === 0 ? ' · 默认' : ''}</span>{index > 0 && <button className={styles.textAction} onClick={() => setAuthorizedServices(current => [service, ...current.filter(item => item.id !== service.id)])}>设为默认服务</button>}<button className={styles.textAction} aria-label={`移除${service.name}`} onClick={() => setAuthorizedServices(current => current.filter(item => item.id !== service.id))}>移除</button></div>)}</div>
          <div className={styles.serviceInputs}><label>顺丰服务产品<select value={newServiceId} onChange={event => { const item = SF_SERVICE_CATALOG.find(row => row.id === Number(event.target.value)); setNewServiceId(event.target.value); setNewServiceName(item?.name || ''); setNewServicePreference(item?.preference || 'standard') }}><option value="">从官方目录选择</option>{SF_SERVICE_CATALOG.map(item => <option key={item.id} value={item.id} disabled={Boolean(item.limitation)}>{item.name}{item.limitation ? '（需扩展跨境/港澳台表单）' : ''}</option>)}</select></label><button className={styles.secondary} onClick={addService}><Plus size={14}/>添加服务</button></div>
          <p className={styles.hint}>第一项为员工默认服务。可选择标快、特快、即日、半日达等目录产品；跨境和港澳台产品缺少国家/报关字段，暂不能提报。当前单票表单上限 20kg，特殊产品仍需对应接口授权。</p>

          <div className={styles.actions}><button disabled={!!busy} onClick={() => void saveConnection()}>{busy === 'connection' ? '保存中…' : '保存连接'}</button><button className={styles.secondary} disabled={!!busy || !connection || !authorizedServices.length} onClick={() => void saveAuthorizedServices()}>{busy === 'services' ? '保存服务中…' : '保存可提报服务'}</button><button className={styles.secondary} disabled={!!busy || (environment === 'sandbox' ? !hasSandboxConnection : !connection)} onClick={() => void testConnection()}>{busy === 'probe' ? <><LoaderCircle size={14}/>测试中…</> : environment === 'sandbox' ? '测试沙盒连接' : '测试生产连接（只读）'}</button></div>
          {legacyConfigurationAvailable[environment] && <div className={styles.legacyImport}><p>检测到此环境仍有旧版服务器配置。迁入会将缺少的连接、服务、月结账号或寄件人资料存入数据库；凭据和月结卡号由服务端加密，日常下单改读数据库。</p><button className={styles.secondary} disabled={!!busy} onClick={() => void importLegacyConfiguration()}>{busy === 'legacy-import' ? '迁入中…' : `迁入旧${environment === 'sandbox' ? '沙盒' : '生产'}配置`}</button></div>}
          {legacyMigrationReport && <div className={styles.message} role="status">{legacyMigrationReport.imported.length ? `已迁入：${legacyMigrationReport.imported.join('、')}。` : '没有发现可迁入的新配置。'}{legacyMigrationReport.needsAttention.length > 0 && <small>需管理员复核：{legacyMigrationReport.needsAttention.join('；')}</small>}</div>}
          {environment === 'sandbox' && !hasSandboxConnection && <p className={styles.hint}>请先保存沙盒连接，再运行只读连通性测试。</p>}
          {environment === 'production' && <p className={styles.hint}>生产连接测试只调用只读订单查询，不创建运单，也不证明生产下单权限。首票实际寄件仍需操作员逐票核对资料与费用后确认。</p>}
          {probeMessage && <p className={`${styles.probe} ${probePassed ? styles.success : styles.failure}`} role="status">{probePassed && <CheckCircle2 size={14}/>} {probeMessage}</p>}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}><div><Settings size={16}/><h3>月结账号</h3></div><span>账号仅显示尾号</span></div>
          <div className={styles.accountList}>{configuration.billingAccounts.map(account => <article key={account.id} className={styles.account}><div><strong>{account.displayName}</strong><small>{account.environment === 'sandbox' ? '沙盒' : '生产'} · 尾号 {account.tail} · {account.status === 'active' ? '可用' : '已停用'}{account.isDefault ? ' · 默认' : ''}</small></div><div className={styles.accountActions}>{account.status === 'active' && !account.isDefault && <button className={styles.textAction} disabled={!!busy} onClick={() => void mutate(`default-${account.id}`, 'set_default_account', { accountId: account.id })}>设默认</button>}{account.status === 'active' && <button className={styles.textAction} disabled={!!busy} onClick={() => void mutate(`disable-${account.id}`, 'deactivate_account', { accountId: account.id })}>停用</button>}</div></article>)}</div>
          <label>月结卡号<input autoComplete="off" inputMode="numeric" value={accountNumber} onChange={event => setAccountNumber(event.target.value.replace(/\D/g, '').slice(0, 32))} placeholder="输入完整月结卡号"/></label>
          <label>备注说明（选填）<input value={accountName} onChange={event => setAccountName(event.target.value)} maxLength={80}/></label>
          <button className={styles.secondary} disabled={!!busy} onClick={() => void saveAccount()}>{busy === 'account' ? '保存中…' : <><Plus size={14}/>保存月结账号</>}</button>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}><div><Settings size={16}/><h3>公司默认寄件人</h3></div></div>
          <div className={styles.twoColumns}><label>粘贴默认寄方信息<textarea aria-label="默认寄方地址文本" rows={3} value={senderText} onChange={event => setSenderText(event.target.value)} placeholder="姓名 电话 省市区及详细地址"/></label><button type="button" disabled={!senderText.trim() || !!busy} onClick={() => { const parsed = parseAddress(senderText); setSender(parsed.contact); setMessage(parsed.warnings.join('；')) }}>解析默认寄方信息</button><label>姓名<input value={sender.name} onChange={event => setSender(value => ({ ...value, name: event.target.value }))}/></label><label>电话<input value={sender.phone} onChange={event => setSender(value => ({ ...value, phone: event.target.value }))}/></label></div>
          <div className={styles.threeColumns}><label>省<input value={sender.province} onChange={event => setSender(value => ({ ...value, province: event.target.value }))}/></label><label>市<input value={sender.city} onChange={event => setSender(value => ({ ...value, city: event.target.value }))}/></label><label>区县<input value={sender.county} onChange={event => setSender(value => ({ ...value, county: event.target.value }))}/></label></div>
          <label>详细地址<input value={sender.address} onChange={event => setSender(value => ({ ...value, address: event.target.value }))}/></label>
          <button disabled={!!busy} onClick={() => void saveSenderProfile()}>{busy === 'sender' ? '保存中…' : '保存寄件人信息'}</button>
        </section>
        <section className={styles.section}>
          <div className={styles.sectionTitle}><div><ShieldCheck size={16}/><h3>下单确认人员</h3></div><span>按组织授权</span></div>
          <p className={styles.hint}>只授予ONES自助收寄操作权限，不授予连接、月结账号或账单管理权限。人员限当前组织且账号已启用。</p>
          {operatorAccess?.legacyImportAvailable && <div className={styles.message}>
            <p>当前环境仍有旧的临时寄件名单。先将原有授权迁到组织权限表，迁移会保留当前名单，不增加其他人员。</p>
            <button className={styles.secondary} disabled={operatorBusy} onClick={() => void importLegacyOperatorAccess()}>{operatorBusy ? '迁移中…' : '迁移当前寄件名单'}</button>
          </div>}
          <div className={styles.operatorList}>
            {(operatorAccess?.operators || []).map(operator => <label key={operator.id} className={styles.operatorRow}>
              <input type="checkbox" checked={operatorDraft.includes(operator.id)} disabled={!operator.enabled || operatorBusy || !!operatorAccess?.legacyImportAvailable} onChange={event => setOperatorDraft(current => event.target.checked ? [...new Set([...current, operator.id])] : current.filter(id => id !== operator.id))}/>
              <span>{operator.name}</span>
              {!operator.enabled && <small>账号未启用</small>}
              {operator.grantSource === 'legacy' && <small>待迁移</small>}
            </label>)}
            {!operatorAccess?.operators.length && <p className={styles.hint}>当前组织没有可授权的启用账号。</p>}
          </div>
          <div className={styles.actions}><button className={styles.secondary} disabled={!operatorAccess || operatorAccess.legacyImportAvailable || operatorBusy} onClick={() => void saveOperatorAccess()}>{operatorBusy ? '保存中…' : '保存确认人员权限'}</button></div>
          {operatorMessage && <p className={styles.probe} role="status">{operatorMessage}</p>}
        </section>
        <p className={styles.footerNote}>连接检查使用所选环境的OAuth2与只读订单查询，不创建运单；轨迹、取消等能力仍需分别验证。</p>
      </div>
    </aside>
  </div>
}
