'use client'

import { useEffect, useState } from 'react'
import type { CompanyEmailSettings } from '@/lib/shipping/company-email-settings'
import styles from './config-drawer.module.css'

async function request(init?: RequestInit): Promise<{ settings: CompanyEmailSettings; message?: string }> {
  const response = await fetch('/api/shipping/email-settings', { ...init, cache: 'no-store', headers: init?.body ? { 'Content-Type': 'application/json' } : undefined })
  const body = await response.json()
  if (!response.ok || !body.settings) throw new Error(body.error || '邮箱配置暂不可用')
  return body
}

function EmailSettingsForm() {
  const [settings, setSettings] = useState<CompanyEmailSettings | null>(null)
  const [domains, setDomains] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    void request().then(reply => { if (active) { setSettings(reply.settings); setDomains(reply.settings.allowedDomains.join(', ')) } }).catch(error => { if (active) setMessage((error as Error).message) })
    return () => { active = false }
  }, [])
  async function save() {
    if (!settings || busy) return
    setBusy(true); setMessage('')
    try {
      const reply = await request({ method: 'POST', body: JSON.stringify({ action: 'save', settings: {
        enabled: settings.enabled, requireVerification: settings.requireVerification ?? false, allowedDomains: domains.split(/[\s,，;；]+/).filter(Boolean),
        smtpHost: settings.smtpHost, smtpPort: settings.smtpPort, fromEmail: settings.fromEmail,
        fromName: settings.fromName, ...(password ? { password } : {}), expectedUpdatedAt: settings.updatedAt,
      } }) })
      setSettings(reply.settings); setDomains(reply.settings.allowedDomains.join(', ')); setPassword(''); setDirty(false); setMessage('邮箱配置已保存。')
    } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }
  async function probe() {
    if (busy || dirty) return
    setBusy(true); setMessage('')
    try {
      const reply = await request({ method: 'POST', body: JSON.stringify({ action: 'test_connection' }) })
      setSettings(reply.settings); setDomains(reply.settings.allowedDomains.join(', ')); setMessage(reply.message || '')
    } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }
  return <div>
    <p className={styles.hint}>默认允许匿名提报，无需账号密码。邮箱验证是可选能力，用于保存个人资料和查看本人历史；开启强制验证前需完成发信配置。</p>
    {settings && <fieldset disabled={busy} onChange={() => setDirty(true)} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <label className={styles.checkbox}><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked, requireVerification: event.target.checked ? settings.requireVerification : false })}/>启用可选邮箱验证</label>
      {settings.enabled && <>
      <label>允许的公司邮箱后缀<input value={domains} onChange={event => setDomains(event.target.value)} placeholder="多个后缀用逗号分隔，例如 company.com"/></label>
<label className={styles.checkbox}><input type="checkbox" disabled={!settings.enabled} checked={settings.requireVerification ?? false} onChange={event => setSettings({ ...settings, requireVerification: event.target.checked })}/>要求员工验证邮箱后才能提报（默认关闭）</label>
      <label>系统发信邮箱<input type="email" autoComplete="off" value={settings.fromEmail} onChange={event => setSettings({ ...settings, fromEmail: event.target.value })} placeholder="用于发送验证码的公司邮箱"/></label>
      <label>发信显示名称<input maxLength={80} value={settings.fromName} onChange={event => setSettings({ ...settings, fromName: event.target.value })}/></label>
      <div className={styles.twoColumns}>
        <label>SMTP服务器<input autoComplete="off" value={settings.smtpHost} onChange={event => setSettings({ ...settings, smtpHost: event.target.value })} placeholder="填写邮箱服务商提供的SMTP域名"/></label>
        <label>安全连接方式<select value={settings.smtpPort} onChange={event => setSettings({ ...settings, smtpPort: event.target.value === '587' ? 587 : 465 })}><option value={465}>SSL/TLS · 465</option><option value={587}>STARTTLS · 587</option></select></label>
      </div>
      <label>SMTP客户端授权信息<input type="password" name="shipping-smtp-authorization" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} placeholder={settings.hasCredentials ? '已加密保存；留空保持' : '服务端加密保存，不会回显'}/></label>
      </>}
      <div className={styles.actions}><button type="button" onClick={() => void save()}>保存邮箱配置</button>{settings.enabled && <button type="button" className={styles.secondary} disabled={!settings.hasCredentials || dirty} onClick={() => void probe()}>测试SMTP连接（不发邮件）</button>}</div>
      {dirty && <p className={styles.hint}>请先保存当前更改，再测试这份配置。</p>}
      {settings.enabled && <p className={styles.hint}>连接检查仅核验网络与SMTP认证；实际验证码需由员工本人收取后验证。</p>}
    </fieldset>}
    {!settings && !message && <p className={styles.hint}>正在读取邮箱配置…</p>}
    {message && <p className={styles.message} role="status">{message}</p>}
  </div>
}

export default function EmailConfiguration() {
  const [open, setOpen] = useState(true)
  return <section className={styles.section} aria-label="员工邮箱验证配置">
    <div className={styles.sectionTitle}><div><h3>员工提报与邮箱验证</h3></div></div>
    <button type="button" className={styles.secondary} aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? '收起邮箱配置' : '配置公司邮箱验证'}</button>
    {open && <EmailSettingsForm/>}
  </section>
}
