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
  const response = await fetch(endpoint, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store', signal: AbortSignal.timeout(10000) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '员工寄件服务暂不可用')
  return data
}
export type EmployeeAccessState = { employee: EmployeeProfile | null; controls: ReactNode; canSubmit: boolean; unavailableReason: string; sessionKey: number; sender: Contact; team: string }
export default function EmployeeAccess({ children, requireVerification = false, emailAvailable = true }: { children: (state: EmployeeAccessState) => ReactNode; requireVerification?: boolean; emailAvailable?: boolean }) {
  const [remember, setRemember] = useState(false)
  const [sessionKey, setSessionKey] = useState(0)
  const [employee, setEmployee] = useState<EmployeeProfile | null>(null)
  const [loading, setLoading] = useState(true), [loadFailed, setLoadFailed] = useState(false)
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [challenge, setChallenge] = useState('')
  const [sender, setSender] = useState<Contact>(emptyContact), [team, setTeam] = useState('')
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [retryAt, setRetryAt] = useState(0), [now, setNow] = useState(Date.now)
  const running = useRef(false)
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem('shipping-anonymous-sender-v1') || 'null'); if (saved?.remember && contactSchema.safeParse(saved.sender).success && typeof saved.team === 'string') { setSender(saved.sender); setTeam(saved.team); setRemember(true) } } catch { /* optional device preference */ } }, [])
  useEffect(() => { if (!remember || employee) return; try { localStorage.setItem('shipping-anonymous-sender-v1', JSON.stringify({ remember: true, sender, team })) } catch { /* private browsing must not block intake */ } }, [remember, sender, team, employee])

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
      <div className={styles.cardTitle}><div><h2>{requireVerification ? '公司要求邮箱验证' : '邮箱验证（可选）'}</h2><p>{requireVerification ? '本公司启用了邮箱验证要求。' : '无需注册、登录或验证码即可提报工单。'} 验证邮箱后可保存个人资料和查看本人历史，本设备会话有效期 60 天。</p></div></div>
      {loading ? <p role="status">正在读取个人寄件资料…</p> : loadFailed ? <>{feedback}{!requireVerification && <p>暂时无法读取已验证资料，仍可填写下方资料匿名提报，无需登录或验证码。</p>}<button type="button" onClick={load}>重新读取资料</button></> : !employee && !emailAvailable ? <p>邮箱验证尚未启用，不影响匿名提报。</p> : !employee ? <form onSubmit={verify}>
        <fieldset disabled={busy} className={styles.verificationRow}>
          <label>公司邮箱<input type="email" required autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setChallenge(''); setCode(''); setNotice('') }}/></label>
          <button type="button" disabled={!email || now < retryAt} onClick={requestCode}>{now < retryAt ? `${Math.ceil((retryAt - now) / 1000)} 秒后可重发` : '获取验证码'}</button>
          {challenge && <><label>邮箱验证码<input required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}/></label><button type="submit">验证邮箱</button></>}
        </fieldset>{feedback}
      </form> : <><div className={styles.identityRow}><span>{employee.email} · 已验证</span><button type="button" disabled={busy} onClick={() => act(async () => { await call({ action: 'logout' }); accept(null); setRemember(false); try { localStorage.removeItem('shipping-anonymous-sender-v1') } catch { /* optional device storage */ } setSessionKey(key => key + 1); setEmail(''); setChallenge(''); setCode('') })}>退出 / 换人</button></div>{feedback}</>}
    </section>
    <section className={`${styles.card} ${styles.accessCard}`} aria-label="我的寄件资料">
      <div className={styles.cardTitle}><div><h2>我的寄件资料</h2><p>填写实际寄件人和揽收地址，提交后由操作员核对确认。</p></div></div>
      {editing || !employee?.sender ? <form onSubmit={save}>
        <fieldset disabled={busy} className={styles.fields}>
          <div className={styles.grid2}>{(['name','phone','province','city','county','address'] as const).map((field, index) => <label key={field}>{['寄件人姓名','寄件人联系电话','寄件省份','寄件城市','寄件区县','详细寄件地址'][index]}<input required value={sender[field]} onChange={e => setSender(current => ({ ...current, [field]: e.target.value }))}/></label>)}</div>
          <label>所属团队<input required maxLength={80} value={team} onChange={e => setTeam(e.target.value)}/></label>
          <div className={styles.identityRow}>{employee && <button type="submit" disabled={loading || loadFailed}>保存寄件资料</button>}{!employee && <label className={styles.remember}><input type="checkbox" checked={remember} onChange={e => { setRemember(e.target.checked); if (!e.target.checked) { try { localStorage.removeItem('shipping-anonymous-sender-v1') } catch { /* optional device storage */ } } }}/>在本设备记住寄件资料（公共设备请勿勾选）</label>}{employee?.sender && <button type="button" onClick={() => { accept(employee); setEditing(false); setError('') }}>取消修改</button>}</div>
        </fieldset>
      </form> : <><p>{employee.sender.name} · {employee.sender.phone} · {employee.team}</p><p>{employee.sender.province}{employee.sender.city}{employee.sender.county}{employee.sender.address}</p><button type="button" disabled={busy} onClick={() => { accept(employee); setEditing(true) }}>修改我的寄件资料</button></>}
    </section>
    {employee && <details className={styles.card}><summary>我的提报记录</summary><MyWorkorders key={employee.id}/></details>}
  </>
  const senderCheck = contactSchema.safeParse({ ...sender, phone: normalizeDomesticShippingPhone(sender.phone) })
  const unavailableReason = loading ? '正在读取寄件资料，请稍候…' : busy ? '正在处理资料，请稍候…' : requireVerification && !employee ? '公司已要求邮箱验证，请先完成验证。' : !senderCheck.success ? `请完善寄件资料：${senderCheck.error.issues.map(issue => issue.message).join('；')}` : !team.trim() ? '请填写所属团队。' : ''
  return children({ employee, controls, unavailableReason, canSubmit: Boolean((!requireVerification || employee) && !busy && !loading && (!loadFailed || !requireVerification) && contactSchema.safeParse({ ...sender, phone: normalizeDomesticShippingPhone(sender.phone) }).success && team.trim()), sessionKey, sender, team })
}
