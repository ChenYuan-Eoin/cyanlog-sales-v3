'use client'
import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react'
import { contactSchema } from '@/lib/shipping/validation'
import { normalizeDomesticShippingPhone } from '@/lib/shipping/phone'
import { emptyContact, type Contact } from '@/lib/shipping/types'
import styles from './sales-portal.module.css'
import MyWorkorders from './my-workorders'
export type EmployeeProfile = { id: string; email: string; sender: Contact | null; team: string; updatedAt: string }
const endpoint = '/api/shipping/public/employee'
async function call(body?: unknown) {
  const response = await fetch(endpoint, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '员工寄件服务暂不可用')
  return data
}
export type EmployeeAccessState = { employee: EmployeeProfile | null; controls: ReactNode; canSubmit: boolean; sessionKey: number }
export default function EmployeeAccess({ children }: { children: (state: EmployeeAccessState) => ReactNode }) {
  const [sessionKey, setSessionKey] = useState(0)
  const [employee, setEmployee] = useState<EmployeeProfile | null>(null)
  const [loading, setLoading] = useState(true), [loadFailed, setLoadFailed] = useState(false)
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [challenge, setChallenge] = useState('')
  const [sender, setSender] = useState<Contact>(emptyContact), [team, setTeam] = useState('')
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [retryAt, setRetryAt] = useState(0), [now, setNow] = useState(Date.now)
  const running = useRef(false)
  function accept(profile: EmployeeProfile | null, preserveDraft = false) {
    setEmployee(profile)
    if (profile?.sender || !preserveDraft) { setSender(profile?.sender || emptyContact()); setTeam(profile?.team || '') }
    setEditing(!!profile && !profile.sender)
  }
  async function load() {
    setLoading(true); setError(''); setLoadFailed(false)
    try { const data = await call(); accept(data.employee, true) } catch (e) { setLoadFailed(true); setError(e instanceof Error ? e.message : '暂时无法读取资料') } finally { setLoading(false) }
  }
  useEffect(() => { let alive = true; call().then(data => { if (alive) accept(data.employee, true) }).catch(e => { if (alive) { setLoadFailed(true); setError(e.message) } }).finally(() => { if (alive) setLoading(false) }); return () => { alive = false } }, [])
  useEffect(() => { if (!retryAt) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [retryAt])
  async function act(action: () => Promise<void>) {
    if (running.current) return
    running.current = true; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : '操作暂未完成') } finally { running.current = false; setBusy(false) }
  }
  async function requestCode() { await act(async () => { const data = await call({ action: 'request_code', email }); setChallenge(data.challengeId); setCode(''); setRetryAt(Date.now() + 60_000); setNow(Date.now()); setNotice(data.delivery === 'accepted' ? '验证码已交给邮件服务器，请查收（也可检查垃圾邮件）。' : data.delivery === 'failed' ? '邮件未能发送，请联系管理员检查发信配置。' : '邮件发送结果待确认，请检查邮箱；未收到可稍后重新获取。') }) }
  async function verify(event: FormEvent) { event.preventDefault(); await act(async () => { const data = await call({ action: 'verify_code', email, challengeId: challenge, code }); accept(data.employee, true); setChallenge(''); setCode('') }) }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!employee) return
    await act(async () => { const result = contactSchema.safeParse({ ...sender, phone: normalizeDomesticShippingPhone(sender.phone) }); if (!result.success) throw new Error(result.error.issues.map(issue => issue.message).join('；'))
      const data = await call({ action: 'save_profile', profile: { sender: result.data, team, expectedUpdatedAt: employee.updatedAt } }); accept(data.employee); setEditing(false)
    })
  }
  const feedback = <>{error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status">{notice}</p>}</>
  const controls = <>
    <section className={`${styles.card} ${styles.accessCard}`} aria-label="邮箱验证">
      <div className={styles.cardTitle}><div><h2>邮箱验证</h2><p>可先填写下方资料，提交前验证公司邮箱。本设备验证有效期为 60 天。</p></div></div>
      {loading ? <p role="status">正在读取个人寄件资料…</p> : loadFailed ? <>{feedback}<button type="button" onClick={load}>重新读取资料</button></> : !employee ? <form onSubmit={verify}>
        <fieldset disabled={busy} className={styles.verificationRow}>
          <label>公司邮箱<input type="email" required autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setChallenge(''); setCode(''); setNotice('') }}/></label>
          <button type="button" disabled={!email || now < retryAt} onClick={requestCode}>{now < retryAt ? `${Math.ceil((retryAt - now) / 1000)} 秒后可重发` : '获取验证码'}</button>
          {challenge && <><label>邮箱验证码<input required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}/></label><button type="submit">验证邮箱</button></>}
        </fieldset>{feedback}
      </form> : <><div className={styles.identityRow}><span>{employee.email} · 已验证</span><button type="button" disabled={busy} onClick={() => act(async () => { await call({ action: 'logout' }); accept(null); setSessionKey(key => key + 1); setEmail(''); setChallenge(''); setCode('') })}>退出 / 换人</button></div>{feedback}</>}
    </section>
    <section className={`${styles.card} ${styles.accessCard}`} aria-label="我的寄件资料">
      <div className={styles.cardTitle}><div><h2>我的寄件资料</h2><p>保存一次，之后自动使用。操作员确认后按此地址联系上门揽收。</p></div></div>
      {editing || !employee?.sender ? <form onSubmit={save}>
        <fieldset disabled={busy} className={styles.fields}>
          <div className={styles.grid2}>{(['name','phone','province','city','county','address'] as const).map((field, index) => <label key={field}>{['寄件人姓名','寄件人联系电话','寄件省份','寄件城市','寄件区县','详细寄件地址'][index]}<input required value={sender[field]} onChange={e => setSender(current => ({ ...current, [field]: e.target.value }))}/></label>)}</div>
          <label>所属团队<input required maxLength={80} value={team} onChange={e => setTeam(e.target.value)}/></label>
          <div className={styles.identityRow}><button type="submit" disabled={!employee || loading || loadFailed}>保存寄件资料</button>{!employee && <span>邮箱验证后即可保存，已填内容会保留。</span>}{employee?.sender && <button type="button" onClick={() => { accept(employee); setEditing(false); setError('') }}>取消修改</button>}</div>
        </fieldset>
      </form> : <><p>{employee.sender.name} · {employee.sender.phone} · {employee.team}</p><p>{employee.sender.province}{employee.sender.city}{employee.sender.county}{employee.sender.address}</p><button type="button" disabled={busy} onClick={() => { accept(employee); setEditing(true) }}>修改我的寄件资料</button></>}
    </section>
    {employee && <details className={styles.card}><summary>我的提报记录</summary><MyWorkorders key={employee.id}/></details>}
  </>
  return children({ employee, controls, canSubmit: Boolean(employee?.sender && !editing && !busy && !loading && !loadFailed), sessionKey })
}
