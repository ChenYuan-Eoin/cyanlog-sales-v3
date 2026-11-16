'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, LoaderCircle, Plus, Settings, ShieldCheck, X } from 'lucide-react'
import type { ShippingConfiguration } from '@/lib/shipping/connections'
import { emptyContact, type Contact } from '@/lib/shipping/types'
import styles from './config-drawer.module.css'
import { contactSchema } from '@/lib/shipping/validation'
import { parseAddress } from '@/lib/shipping/address'
import IntakeConfiguration from './intake-configuration'
import { SF_SERVICE_CATALOG, DEFAULT_INTAKE_SERVICES } from '@/lib/shipping/sf-service-catalog'

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch('/api/shipping/settings', { ...init, cache: 'no-store', headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '配置暂未保存')
  return data as T
}

type ConfigurationReply = {
  credentialStorageReady?: boolean
  deploymentEnvironment?: 'production' | 'preview' | 'development' | 'unknown'
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

type Environment = 'sandbox' | 'production'
type Service = { id: number; name: string; preference: 'standard' | 'urgent' }

export default function ShippingConfigDrawer({ open = true, onClose, embedded = false }: { open?: boolean; onClose?: () => void; embedded?: boolean }) {
  const [configuration, setConfiguration] = useState<ShippingConfiguration>({ connections: [], billingAccounts: [], sender: null })
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('production')
  const [deploymentEnvironment, setDeploymentEnvironment] = useState<NonNullable<ConfigurationReply['deploymentEnvironment']>>('unknown')
  const [saveFailed, setSaveFailed] = useState(false)
  const [credentialStorageReady, setCredentialStorageReady] = useState(true)
  const [partnerId, setPartnerId] = useState('')
  const [checkWord, setCheckWord] = useState('')
  const [serviceDrafts, setServiceDrafts] = useState<Partial<Record<Environment, Service[]>>>({})
  const connection = configuration.connections.find(item => item.carrier === 'sf' && item.environment === environment)
  const authorizedServices = serviceDrafts[environment] ?? (connection?.services?.length ? connection.services : DEFAULT_INTAKE_SERVICES.map(({ id, name, preference }) => ({ id, name, preference })))
  function setAuthorizedServices(value: Service[] | ((current: Service[]) => Service[])) {
    setServiceDrafts(current => ({ ...current, [environment]: typeof value === 'function' ? value(current[environment] ?? authorizedServices) : value }))
  }
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
  const [operatorIds, setOperatorIds] = useState<string[]>([])
  const [operatorSearch, setOperatorSearch] = useState('')
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
    setCredentialStorageReady(data.credentialStorageReady !== false)
    setDeploymentEnvironment(data.deploymentEnvironment || 'unknown')
    if (data.legacyConfigurationAvailable) setLegacyConfigurationAvailable(data.legacyConfigurationAvailable)
    if (data.operatorAccess) {
      setOperatorAccess(data.operatorAccess)
      setOperatorIds(data.operatorAccess.operators.filter(item => item.canOperate).map(item => item.id))
    }
    const savedSender = data.configuration.sender
    if (savedSender) {
      setSenderName(savedSender.displayName)
      setSender({ name: savedSender.name, phone: savedSender.phone, province: savedSender.province, city: savedSender.city, county: savedSender.county, address: savedSender.address })
    }
    setAccessState('ready')
  }

  useEffect(() => { if (open || embedded) { setAccessState('checking'); setMessage(''); void refresh().catch(error => { setAccessState('unavailable'); setMessage((error as Error).message) }) } }, [open, embedded])

  function changeEnvironment(next: Environment) {
    setEnvironment(next)
    // Credentials and account numbers must never silently carry into another environment.
    setPartnerId(''); setCheckWord(''); setAccountNumber(''); setAccountName('')
    setNewServiceId(''); setNewServiceName(''); setProbeMessage(''); setProbePassed(false)
    setMessage('已切换环境。未保存的应用凭据和月结卡号已清空；服务产品草稿按环境保留。')
  }

  async function mutate(label: string, action: string, values: Record<string, unknown> = {}) {
    setBusy(label); setMessage(''); setSaveFailed(false)
    try {
      const data = await request<ConfigurationReply>({ method: 'POST', body: JSON.stringify({ action, ...values }) })
      if (data.configuration) setConfiguration(data.configuration)
      if (data.operatorAccess) {
        setOperatorAccess(data.operatorAccess)
      setOperatorIds(data.operatorAccess.operators.filter(item => item.canOperate).map(item => item.id))
      }
      if (data.legacyConfigurationAvailable) setLegacyConfigurationAvailable(data.legacyConfigurationAvailable)
      if (data.imported || data.needsAttention) setLegacyMigrationReport({ imported: data.imported || [], needsAttention: data.needsAttention || [] })
      if (!data.configuration && !data.operatorAccess) throw new Error('配置更新成功，但服务器未返回最新配置。请刷新后检查。')
      setMessage(`${label === 'connection' ? '顺丰连接' : label === 'services' ? '可提报服务' : label === 'account' ? '月结账号' : label === 'sender' ? '默认寄件资料' : label === 'operators' ? '操作员授权' : '配置'}已保存。`)
      return data
    } catch (error) { setMessage((error as Error).message); setSaveFailed(true); return null } finally { setBusy('') }
  }

  async function saveConnection() {
    if (!credentialStorageReady) return
    if (!partnerId.trim() || !checkWord.trim()) { setMessage('请填写 PartnerID 和应用密钥。'); return }
    setProbeMessage(''); setProbePassed(false)
    const saved = await mutate('connection', 'save_connection', { environment, partnerId, checkWord, services: authorizedServices })
    if (saved) { setPartnerId(''); setCheckWord(''); setServiceDrafts(current => ({ ...current, [environment]: undefined })) }
  }

  async function saveAuthorizedServices() {
    if (!connection) { setMessage('请先保存当前环境的顺丰连接。'); return }
    if (!authorizedServices.length) { setMessage('请至少添加一项顺丰服务产品。'); return }
    const saved = await mutate('services', 'save_authorized_services', { environment, services: authorizedServices })
    if (saved) setServiceDrafts(current => ({ ...current, [environment]: undefined }))
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
    if (!credentialStorageReady) return
    if (!accountNumber.trim()) { setMessage('请输入月结卡号。'); return }
    const saved = await mutate('account', 'add_billing_account', { accountNumber, displayName: accountName, environment })
    if (saved) { setAccountNumber('') }
  }

  async function saveSenderProfile() {
    await mutate('sender', 'save_sender', { displayName: senderName, contact: sender })
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
  const environmentAccounts = configuration.billingAccounts.filter(account => account.environment === environment)
  return <div className={embedded ? styles.embedded : styles.backdrop} role={embedded ? 'region' : 'presentation'} onMouseDown={event => { if (!embedded && event.target === event.currentTarget) onClose?.() }}>
    <aside className={styles.drawer} role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : true} aria-labelledby="shipping-config-title">
      <header className={styles.header}>
        <h2 id="shipping-config-title">寄件设置</h2>
        {!embedded && <button className={styles.close} aria-label="关闭寄件配置" onClick={onClose}><X size={18}/></button>}
      </header>
      {message && <p className={`${styles.message} ${styles.feedback}`} role="status" aria-live="polite">{message}</p>}
      {saveFailed && message && <p className={styles.hint} role="status">本次保存未确认成功，输入和原有配置仍保留。</p>}
      <div className={styles.content}>
        <div className={styles.siteBar} aria-label="站点部署环境">
          <span>{deploymentEnvironment === 'production' ? '当前站点：正式环境' : deploymentEnvironment === 'preview' ? '当前站点：预览环境' : deploymentEnvironment === 'development' ? '当前站点：开发环境' : '当前站点：部署环境未确认'}</span>
          {deploymentEnvironment !== 'production' && <a href="https://sales.cyanlog.icu/configs?tab=shipping">前往正式站 →</a>}
          <a href="/shipping">返回收寄工作台 →</a>
        </div>
        <section aria-label="顺丰接入内容">
          <div className={styles.panelHeading}><h3>顺丰接入</h3></div>
          {!credentialStorageReady && <p className={styles.message} role="alert">当前站点暂时无法保存应用密钥和月结账号，请联系管理员修复。已保存的信息仍显示在下方，无需重新填写。</p>}
          <div className={styles.environmentBar}>
            <label>顺丰接口环境<select aria-label="运行环境" value={environment} disabled={!!busy} onChange={event => changeEnvironment(event.target.value as Environment)}><option value="production">生产</option><option value="sandbox">沙盒</option></select></label>
          </div>
          <section className={styles.section} aria-label="顺丰应用连接">
            <fieldset className={styles.formGroup} disabled={!!busy}>
              <div className={styles.sectionTitle}><div><ShieldCheck size={16}/><h4>应用连接</h4></div><span>{connection ? `PartnerID 尾号 ${connection.partnerIdTail}` : '尚未配置'}</span></div>
              {connection && <div className={styles.connectionStatus}>
                <strong>{connection.status === 'connected' ? '连接测试通过' : connection.status === 'failed' ? '连接测试失败' : '已保存，待测试'}</strong>
                {connection.lastTestedAt && <span>最近测试：{new Date(connection.lastTestedAt).toLocaleString('zh-CN')}</span>}
              </div>}
              <details open={!connection}>
                <summary>{connection ? '更换应用凭据' : '填写应用凭据'}</summary>
                <div className={styles.twoColumns}>
                  <label>PartnerID<input autoComplete="off" value={partnerId} onChange={event => setPartnerId(event.target.value)} placeholder="顺丰应用编号"/></label>
                  <label>应用密钥<input autoComplete="new-password" type="password" value={checkWord} onChange={event => setCheckWord(event.target.value)} placeholder={connection ? '填写新密钥' : '顺丰应用密钥'}/></label>
                </div>
                <div className={styles.actions}><button disabled={!!busy || !credentialStorageReady} onClick={() => void saveConnection()}>{busy === 'connection' ? '保存中…' : '保存连接'}</button></div>
              </details>
              <div className={styles.actions}>
                <button className={styles.secondary} disabled={!!busy || !connection} onClick={() => void testConnection()}>{busy === 'probe' ? <><LoaderCircle size={14}/>测试中…</> : environment === 'sandbox' ? '测试沙盒连接' : '测试生产连接（只读）'}</button>
              </div>
              <p className={styles.actionHint}>{connection ? '仅查询订单，不会创建或取消运单。' : '保存连接后可测试。'}</p>
              {probeMessage && <p className={`${styles.probe} ${probePassed ? styles.success : styles.failure}`} role="status">{probePassed && <CheckCircle2 size={14}/>} {probeMessage}</p>}
              {legacyConfigurationAvailable[environment] && <div className={styles.legacyImport}>
                <p>发现旧版配置，可补充导入尚未保存的连接、月结账号和寄件资料。</p>
                <button className={styles.secondary} disabled={!!busy} onClick={() => void importLegacyConfiguration()}>{busy === 'legacy-import' ? '迁入中…' : `迁入旧${environment === 'sandbox' ? '沙盒' : '生产'}配置`}</button>
              </div>}
              {legacyMigrationReport && <div className={styles.message} role="status">{legacyMigrationReport.imported.length ? `已迁入：${legacyMigrationReport.imported.join('、')}。` : '没有发现可迁入的新配置。'}{legacyMigrationReport.needsAttention.length > 0 && <small>需管理员复核：{legacyMigrationReport.needsAttention.join('；')}</small>}</div>}
            </fieldset>
          </section>

          <section className={styles.section} aria-label="月结与服务">
            <div className={styles.sectionTitle}><div><Settings size={16}/><h4>月结与服务</h4></div></div>
            <fieldset className={styles.formGroup} disabled={!!busy}>
              <h5 className={styles.groupTitle}>月结账号</h5>
              <div className={styles.accountList}>{environmentAccounts.map(account => <article key={account.id} className={styles.account}>
                <div><strong>{account.displayName}</strong><small>{account.environment === 'sandbox' ? '沙盒' : '生产'} · 尾号 {account.tail} · {account.status === 'active' ? '已启用' : '已停用'}{account.isDefault ? ' · 默认' : ''}</small></div>
                <div className={styles.accountActions}>
                  {account.status === 'active' && !account.isDefault && <button className={styles.textAction} disabled={!!busy} onClick={() => void mutate(`default-${account.id}`, 'set_default_account', { accountId: account.id })}>设默认</button>}
                  {account.status === 'active' && <button className={styles.textAction} disabled={!!busy} onClick={() => { if (window.confirm(`停用月结账号「${account.displayName}」（尾号 ${account.tail}）？新工单将无法选择此账号，历史工单记录保留。`)) void mutate(`disable-${account.id}`, 'deactivate_account', { accountId: account.id }) }}>停用</button>}
                </div>
              </article>)}</div>
              {!environmentAccounts.length && <p className={styles.hint}>{deploymentEnvironment === 'preview' || deploymentEnvironment === 'development' ? '当前预览/开发站点未保存该顺丰环境的月结账号；不代表正式站账号缺失。' : '当前站点的所选顺丰环境尚未保存月结账号。'}</p>}
              <div className={styles.twoColumns}>
                <label>月结卡号<input autoComplete="off" inputMode="numeric" value={accountNumber} onChange={event => setAccountNumber(event.target.value.replace(/\D/g, '').slice(0, 32))} placeholder="输入完整月结卡号"/></label>
                <label>备注说明（选填）<input value={accountName} onChange={event => setAccountName(event.target.value)} maxLength={80}/></label>
              </div>
              <div className={styles.actions}><button className={styles.secondary} disabled={!!busy || !credentialStorageReady} onClick={() => void saveAccount()}>{busy === 'account' ? '保存中…' : <><Plus size={14}/>保存月结账号</>}</button></div>

              <div className={styles.serviceHeading}><h5 className={styles.groupTitle}>可提报服务</h5><span>当前顺丰应用下的月结账号共用</span></div>
              <div className={styles.services}>{authorizedServices.map((service, index) => <div key={service.id}>
                <span>{service.name}{index === 0 ? ' · 默认' : ''}</span>
                <div className={styles.accountActions}>{index > 0 && <button className={styles.textAction} onClick={() => setAuthorizedServices(current => [service, ...current.filter(item => item.id !== service.id)])}>设为默认服务</button>}<button className={styles.textAction} aria-label={`移除${service.name}`} onClick={() => setAuthorizedServices(current => current.filter(item => item.id !== service.id))}>移除</button></div>
              </div>)}</div>
              <div className={styles.serviceInputs}>
                <label>顺丰服务产品<select value={newServiceId} onChange={event => { const item = SF_SERVICE_CATALOG.find(row => row.id === Number(event.target.value)); setNewServiceId(event.target.value); setNewServiceName(item?.name || ''); setNewServicePreference(item?.preference || 'standard') }}><option value="">从官方目录选择</option>{SF_SERVICE_CATALOG.map(item => <option key={item.id} value={item.id} disabled={Boolean(item.limitation)}>{item.name}{item.limitation ? '（暂不支持）' : ''}</option>)}</select></label>
                <button className={styles.secondary} onClick={addService}><Plus size={14}/>添加服务</button>
              </div>
              <p className={styles.actionHint}>第一项为默认服务。单票上限 20kg，暂不支持跨境及港澳台寄件。</p>
              <div className={styles.actions}><button className={styles.secondary} disabled={!!busy || !connection || !authorizedServices.length} onClick={() => void saveAuthorizedServices()}>{busy === 'services' ? '保存服务中…' : '保存可提报服务'}</button></div>
              {!connection && <p className={styles.actionHint}>请先保存当前环境的顺丰连接。</p>}
            </fieldset>
          </section>

          <details>
            <summary>接口验证记录</summary>
            <div className={styles.capabilities} aria-label="顺丰能力验证记录">{([['order', '下单'], ['query', '订单查询'], ['tracking', '物流轨迹'], ['cancel', '取消']] as const).map(([key, label]) => <div key={key}><span>{label}</span><b>{connection?.capabilities[key] === 'verified' ? '已有验证记录' : connection?.capabilities[key] === 'unavailable' ? '不可用' : '尚未验证'}</b></div>)}<div><span>订单与路由推送</span><b>接收状态未提供</b></div></div>
            <p className={styles.hint}>可用操作以当前运单状态和顺丰处理结果为准。</p>
          </details>
        </section>

        <section aria-label="寄件业务设置">
          <section className={styles.section} aria-label="默认寄件人内容">
            <div className={styles.sectionTitle}><div><Settings size={16}/><h3>公司默认寄件人</h3></div></div>
            <div className={styles.addressImport}>
              <label>粘贴默认寄方信息<textarea aria-label="默认寄方地址文本" rows={3} value={senderText} onChange={event => setSenderText(event.target.value)} placeholder="姓名 电话 省市区及详细地址"/></label>
              <div className={styles.actions}><button type="button" disabled={!senderText.trim() || !!busy} onClick={() => { const parsed = parseAddress(senderText); if (!contactSchema.safeParse(parsed.contact).success) { setMessage('未识别出完整寄方，原资料已保留。请补齐姓名、电话和完整地址后重试。'); return } setSender(parsed.contact); setMessage(parsed.warnings.join('；') || '寄方已解析，请核对后保存。') }}>解析默认寄方信息</button></div>
            </div>
            <div className={styles.twoColumns}><label>姓名<input value={sender.name} onChange={event => setSender(value => ({ ...value, name: event.target.value }))}/></label><label>电话<input value={sender.phone} onChange={event => setSender(value => ({ ...value, phone: event.target.value }))}/></label></div>
            <div className={styles.threeColumns}><label>省<input value={sender.province} onChange={event => setSender(value => ({ ...value, province: event.target.value }))}/></label><label>市<input value={sender.city} onChange={event => setSender(value => ({ ...value, city: event.target.value }))}/></label><label>区县<input value={sender.county} onChange={event => setSender(value => ({ ...value, county: event.target.value }))}/></label></div>
            <label>详细地址<input value={sender.address} onChange={event => setSender(value => ({ ...value, address: event.target.value }))}/></label>
            <div className={styles.actions}><button disabled={!!busy} onClick={() => void saveSenderProfile()}>{busy === 'sender' ? '保存中…' : '保存寄件人信息'}</button></div>
          </section>
          <details><summary>寄件提报规则</summary><IntakeConfiguration/></details>
          <details>
            <summary>审核与下单权限</summary>
            <IntakeConfiguration mode="departments"/>
            <section className={styles.section} aria-label="寄件操作员授权">
              <h3>审核与下单操作员</h3>
              <p className={styles.hint}>直接授权当前组织成员办理审核、下单及后续寄件操作。组织角色已有权限由“组织与权限”管理，取消直接授权不会撤销角色权限。</p>
              {operatorAccess ? <fieldset className={styles.formGroup} disabled={!!busy}>
                <label>搜索操作员<input value={operatorSearch} onChange={event => setOperatorSearch(event.target.value)} placeholder="成员姓名"/></label>
                <div role="group" aria-label="操作员名单" style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {operatorAccess.operators.filter(item => item.name.includes(operatorSearch.trim())).map(item => <label className={styles.checkbox} key={item.id}><input type="checkbox" disabled={(!item.enabled && !operatorIds.includes(item.id)) || operatorAccess.legacyImportAvailable} checked={operatorIds.includes(item.id)} onChange={event => setOperatorIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/>{item.name}{!item.enabled && '（未启用）'}</label>)}
                  {!operatorAccess.operators.length && <p>当前组织暂无可配置成员。</p>}
                </div>
                {operatorAccess.legacyImportAvailable && <><p className={styles.message}>存在历史授权，请联系管理员核对。</p><button type="button" onClick={() => void mutate('operators', 'import_legacy_operator_access')}>迁入历史操作员授权</button></>}
                <button type="button" disabled={operatorAccess.legacyImportAvailable} onClick={() => void mutate('operators', 'save_operator_access', { userIds: operatorIds })}>{busy === 'operators' ? '保存中…' : '保存操作员授权'}</button>
              </fieldset> : <p role="status">操作员授权暂不可用，请刷新后重试。</p>}
              <a href="/configs?tab=role-access">查看组织角色权限 →</a>
            </section>
          </details>
        </section>
      </div>
    </aside>
  </div>
}
