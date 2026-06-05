'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface UserRow {
  id: string
  email: string
  display_name: string
  title: string
  primary_dept_name: string
  primary_dept_id?: string | null
  role_names: string
  role_codes?: string[]
  status: string
  must_change_password: boolean
}

interface DepartmentRow {
  id: string
  name: string
  code?: string | null
  depth?: number
  parent_id?: string | null
  parent_name: string | null
  member_count: number
}

interface RoleRow {
  id: string
  code: string
  name: string
}

interface OrgPayload {
  organization?: {
    id: string
    name: string
    slug?: string | null
  }
  users: UserRow[]
  departments: DepartmentRow[]
  roles: RoleRow[]
}

const SAMPLE_CSV = `email,display_name,title,department_code,role_codes
zhang.ym@huarun.com,张一鸣,高级销售代表,EAST-MED,SALES
li.fy@huarun.com,李芳颖,销售代表,EAST-MED,SALES
wang.zy@huarun.com,王志远,销售代表,EAST-RTL,SALES
chen.hj@huarun.com,陈慧娟,销售经理,EAST-RTL,SALES_MANAGER
`

export default function OrgAdminPage() {
  const router = useRouter()
  const [tab, setTab] = useState<'users' | 'departments' | 'import'>('users')
  const [organizationName, setOrganizationName] = useState('组织管理')
  const [users, setUsers] = useState<UserRow[]>([])
  const [departments, setDepartments] = useState<DepartmentRow[]>([])
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [csvText, setCsvText] = useState('')
  const [importResult, setImportResult] = useState<{ ok: number; fail: number; errors: string[]; tempPasswords?: string[] } | null>(null)
  const [importing, setImporting] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string>('')
  const [newDepartmentName, setNewDepartmentName] = useState('')
  const [newDepartmentCode, setNewDepartmentCode] = useState('')
  const [newDepartmentParentId, setNewDepartmentParentId] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserName, setNewUserName] = useState('')
  const [newUserTitle, setNewUserTitle] = useState('')
  const [newUserPrimaryDeptId, setNewUserPrimaryDeptId] = useState('')
  const [newUserRoleCodes, setNewUserRoleCodes] = useState<string[]>(['SALES'])
  const [lastTempPassword, setLastTempPassword] = useState('')

  useEffect(() => {
    ;(async () => {
      const token = localStorage.getItem('token')
      const meRes = await fetch('/api/auth/me', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })

      if (!meRes.ok) {
        router.push('/login')
        return
      }

      const { user } = await meRes.json()
      const codes = (user?.roles || []).map((role: { code: string }) => role.code)
      if (!codes.includes('ADMIN') && !codes.includes('SUPER_ADMIN')) {
        alert('无权限访问组织管理')
        router.push('/')
        return
      }
      await loadData()
    })()
  }, [router])

  async function loadData() {
    setLoading(true)
    setMessage('')
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/admin/org', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        throw new Error('组织管理数据加载失败')
      }

      const data = await res.json() as OrgPayload
      setUsers(data.users || [])
      setDepartments(data.departments || [])
      setRoles(data.roles || [])
      setOrganizationName(data.organization?.name || '组织管理')
    } catch (e) {
      console.error('[OrgAdmin] load error', e)
      setMessage('组织管理数据加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function requestOrgApi(method: 'POST' | 'PATCH', body: Record<string, unknown>) {
    const token = localStorage.getItem('token')
    const res = await fetch('/api/admin/org', {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })

    const payload = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(payload.error || '请求失败')
    }

    return payload as Record<string, unknown>
  }

  async function updateDepartment(departmentId: string, patch: { name: string; parentId: string | null }) {
    setSavingId(departmentId)
    try {
      await requestOrgApi('PATCH', {
        type: 'department',
        departmentId,
        name: patch.name,
        parentId: patch.parentId,
      })
      await loadData()
    } catch (e) {
      console.error('[OrgAdmin] update department error', e)
      alert(e instanceof Error ? e.message : '更新部门失败')
    } finally {
      setSavingId(null)
    }
  }

  async function createDepartment() {
    if (!newDepartmentName.trim()) {
      alert('请输入部门名称')
      return
    }

    setSavingId('new-department')
    try {
      await requestOrgApi('POST', {
        type: 'department',
        name: newDepartmentName,
        code: newDepartmentCode || null,
        parentId: newDepartmentParentId || null,
      })
      setNewDepartmentName('')
      setNewDepartmentCode('')
      setNewDepartmentParentId('')
      setMessage('新部门已创建')
      await loadData()
    } catch (e) {
      console.error('[OrgAdmin] create department error', e)
      alert(e instanceof Error ? e.message : '创建部门失败')
    } finally {
      setSavingId(null)
    }
  }

  async function updateUser(userId: string, patch: { title?: string; primaryDeptId?: string | null; status?: string }) {
    setSavingId(userId)
    try {
      await requestOrgApi('PATCH', {
        type: 'user',
        userId,
        ...patch,
      })
      await loadData()
    } catch (e) {
      console.error('[OrgAdmin] update user error', e)
      alert(e instanceof Error ? e.message : '更新成员失败')
    } finally {
      setSavingId(null)
    }
  }

  async function updateUserRoles(userId: string, roleCodes: string[]) {
    setSavingId(`${userId}-roles`)
    try {
      await requestOrgApi('PATCH', {
        type: 'user_roles',
        userId,
        roleCodes,
      })
      await loadData()
    } catch (e) {
      console.error('[OrgAdmin] update user roles error', e)
      alert(e instanceof Error ? e.message : '更新角色失败')
    } finally {
      setSavingId(null)
    }
  }

  async function resetUserPassword(userId: string, email: string) {
    setSavingId(`${userId}-password`)
    try {
      const result = await requestOrgApi('PATCH', {
        type: 'user_password_reset',
        userId,
      })
      const tempPassword = typeof result.tempPassword === 'string' ? result.tempPassword : ''
      setLastTempPassword(tempPassword ? `${email}: ${tempPassword}` : '')
      setMessage(tempPassword ? `${email} 已重置临时密码，用户下次登录将强制改密。` : `${email} 已重置临时密码`)
      await loadData()
    } catch (e) {
      console.error('[OrgAdmin] reset user password error', e)
      alert(e instanceof Error ? e.message : '重置密码失败')
    } finally {
      setSavingId(null)
    }
  }

  async function createUser() {
    if (!newUserEmail.trim() || !newUserName.trim()) {
      alert('请填写成员邮箱和姓名')
      return
    }

    setSavingId('new-user')
    try {
      const result = await requestOrgApi('POST', {
        type: 'user',
        email: newUserEmail,
        displayName: newUserName,
        title: newUserTitle || null,
        primaryDeptId: newUserPrimaryDeptId || null,
        roleCodes: newUserRoleCodes,
        status: 'active',
      })

      const tempPassword = typeof result.tempPassword === 'string' ? result.tempPassword : ''
      setLastTempPassword(tempPassword)
      setNewUserEmail('')
      setNewUserName('')
      setNewUserTitle('')
      setNewUserPrimaryDeptId('')
      setNewUserRoleCodes(['SALES'])
      setMessage(tempPassword ? '成员已创建，首次登录将强制修改密码。' : '成员已创建')
      setLastTempPassword(tempPassword ? `${newUserEmail}: ${tempPassword}` : '')
      await loadData()
    } catch (e) {
      console.error('[OrgAdmin] create user error', e)
      alert(e instanceof Error ? e.message : '创建成员失败')
    } finally {
      setSavingId(null)
    }
  }

  async function handleImport() {
    if (!csvText.trim()) return
    setImporting(true)
    setImportResult(null)
    const lines = csvText.trim().split('\n').filter(l => l.trim())
    if (lines.length < 2) {
      setImportResult({ ok: 0, fail: lines.length, errors: ['CSV 至少需要表头 + 1 行数据'] })
      setImporting(false)
      return
    }

    const header = lines[0].split(',').map(h => h.trim())
    const required = ['email', 'display_name', 'department_code', 'role_codes']
    const missing = required.filter(r => !header.includes(r))
    if (missing.length > 0) {
      setImportResult({ ok: 0, fail: 0, errors: [`缺少列：${missing.join(', ')}`] })
      setImporting(false)
      return
    }

    let ok = 0
    let fail = 0
    const errors: string[] = []
    const tempPasswords: string[] = []

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim())
      const row: Record<string, string> = {}
      header.forEach((h, idx) => { row[h] = cols[idx] || '' })

      const dept = departments.find((item) => item.code === row.department_code)
      if (!dept) {
        errors.push(`第 ${i} 行: 部门代码 ${row.department_code} 不存在`)
        fail++
        continue
      }

      try {
        const payload = await requestOrgApi('POST', {
          type: 'user',
          email: row.email,
          displayName: row.display_name,
          title: row.title || null,
          primaryDeptId: dept.id,
          roleCodes: row.role_codes.split(/[|;]/).map((value) => value.trim()).filter(Boolean),
          status: 'active',
          upsert: true,
        })

        if (typeof payload.tempPassword === 'string') {
          tempPasswords.push(`${row.email}: ${payload.tempPassword}`)
        }
        ok++
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        errors.push(`第 ${i} 行: ${msg}`)
        fail++
      }
    }

    setImportResult({ ok, fail, errors, tempPasswords })
    setImporting(false)
    await loadData()
  }

  const selectableRoles = useMemo(() => roles.filter((role) => role.code !== 'SUPER_ADMIN'), [roles])

  return (
    <div className="content-area" style={{ maxWidth: 1280, margin: '0 auto' }}>
      <div className="breadcrumb">
        <Link href="/" className="breadcrumb-current">首页</Link> / 组织管理
      </div>
      <h1>{organizationName}</h1>
      <p className="subtitle">维护组织架构、成员、角色归属。当前页面已经切到服务端权限收口。</p>

      {message && (
        <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)' }}>
          {message}
        </div>
      )}

      {lastTempPassword && (
        <div style={{ marginTop: 12, padding: 12, background: 'var(--warning-100)', borderRadius: 'var(--radius-md)' }}>
          最新临时密码：<code>{lastTempPassword}</code>。用户首次登录后必须修改密码。
        </div>
      )}

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1.2fr 1fr', marginTop: 20 }}>
        <div className="side-card">
          <h3 style={{ marginBottom: 12, fontSize: 'var(--text-h4)' }}>新增成员</h3>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <input value={newUserName} onChange={(e) => setNewUserName(e.target.value)} placeholder="姓名" />
            <input value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="企业邮箱" />
            <input value={newUserTitle} onChange={(e) => setNewUserTitle(e.target.value)} placeholder="职位" />
            <select value={newUserPrimaryDeptId} onChange={(e) => setNewUserPrimaryDeptId(e.target.value)}>
              <option value="">主部门</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {`${'　'.repeat(dept.depth || 0)}${dept.name}`}
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 'var(--text-body-sm)', marginBottom: 8 }}>组织角色</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {selectableRoles.map((role) => {
                const active = newUserRoleCodes.includes(role.code)
                return (
                  <button
                    key={role.id}
                    type="button"
                    className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setNewUserRoleCodes((prev) => (
                      prev.includes(role.code)
                        ? prev.filter((code) => code !== role.code)
                        : [...prev, role.code]
                    ))}
                  >
                    {role.name}
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" disabled={savingId === 'new-user'} onClick={() => void createUser()}>
              {savingId === 'new-user' ? '创建中...' : '创建成员'}
            </button>
          </div>
        </div>

        <div className="side-card">
          <h3 style={{ marginBottom: 12, fontSize: 'var(--text-h4)' }}>新增部门</h3>
          <div style={{ display: 'grid', gap: 12 }}>
            <input value={newDepartmentName} onChange={(e) => setNewDepartmentName(e.target.value)} placeholder="部门名称" />
            <input value={newDepartmentCode} onChange={(e) => setNewDepartmentCode(e.target.value)} placeholder="部门编码（可选）" />
            <select value={newDepartmentParentId} onChange={(e) => setNewDepartmentParentId(e.target.value)}>
              <option value="">上级部门（根）</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {`${'　'.repeat(dept.depth || 0)}${dept.name}`}
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" disabled={savingId === 'new-department'} onClick={() => void createDepartment()}>
              {savingId === 'new-department' ? '创建中...' : '创建部门'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 24, borderBottom: '1px solid var(--border-1)', paddingBottom: 0 }}>
        <button
          onClick={() => setTab('users')}
          className={`btn btn-ghost ${tab === 'users' ? 'btn-primary' : ''}`}
          style={{ borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0', borderBottom: tab === 'users' ? '2px solid var(--accent)' : '2px solid transparent' }}
        >
          成员 ({users.length})
        </button>
        <button
          onClick={() => setTab('departments')}
          className={`btn btn-ghost ${tab === 'departments' ? 'btn-primary' : ''}`}
          style={{ borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0', borderBottom: tab === 'departments' ? '2px solid var(--accent)' : '2px solid transparent' }}
        >
          部门 ({departments.length})
        </button>
        <button
          onClick={() => setTab('import')}
          className={`btn btn-ghost ${tab === 'import' ? 'btn-primary' : ''}`}
          style={{ borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0', borderBottom: tab === 'import' ? '2px solid var(--accent)' : '2px solid transparent' }}
        >
          导入
        </button>
      </div>

      {loading && <div style={{ padding: 32, textAlign: 'center' }}>加载中...</div>}

      {!loading && tab === 'users' && (
        <div className="side-card" style={{ marginTop: 16 }}>
          <table className="table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>邮箱</th>
                <th>职位</th>
                <th>主部门</th>
                <th>角色</th>
                <th>状态</th>
                <th>密码状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 500 }}>{u.display_name}</td>
                  <td style={{ color: 'var(--fg-3)' }}>{u.email}</td>
                  <td>
                    <input
                      defaultValue={u.title}
                      onBlur={(e) => {
                        if (e.target.value !== u.title) {
                          void updateUser(u.id, { title: e.target.value })
                        }
                      }}
                      style={{ minWidth: 140 }}
                    />
                  </td>
                  <td>
                    <select
                      value={u.primary_dept_id || ''}
                      onChange={(e) => void updateUser(u.id, { primaryDeptId: e.target.value || null })}
                    >
                      <option value="">未设置</option>
                      {departments.map((dept) => (
                        <option key={dept.id} value={dept.id}>
                          {`${'　'.repeat(dept.depth || 0)}${dept.name}`}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ minWidth: 280 }}>
                    <select
                      multiple
                      value={u.role_codes || []}
                      disabled={savingId === `${u.id}-roles`}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions).map((option) => option.value)
                        void updateUserRoles(u.id, selected)
                      }}
                      style={{ minHeight: 84, width: '100%' }}
                    >
                      {selectableRoles.map((role) => (
                        <option key={role.id} value={role.code}>{role.name}</option>
                      ))}
                    </select>
                    <div style={{ marginTop: 6, fontSize: 'var(--text-caption)', color: 'var(--fg-3)' }}>
                      {u.role_names || '-'}
                    </div>
                  </td>
                  <td>
                    <select
                      value={u.status}
                      disabled={savingId === u.id}
                      onChange={(e) => void updateUser(u.id, { status: e.target.value })}
                    >
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                      <option value="suspended">suspended</option>
                    </select>
                  </td>
                  <td>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '4px 8px',
                      borderRadius: 999,
                      fontSize: 'var(--text-caption)',
                      background: u.must_change_password ? 'var(--warning-100)' : 'var(--success-100)',
                      color: u.must_change_password ? 'var(--warning-700)' : 'var(--success-700)',
                    }}>
                      {u.must_change_password ? '待改密' : '正常'}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={savingId === `${u.id}-password`}
                      onClick={() => void resetUserPassword(u.id, u.email)}
                    >
                      {savingId === `${u.id}-password` ? '重置中...' : '重置临时密码'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === 'departments' && (
        <div className="side-card" style={{ marginTop: 16 }}>
          <table className="table">
            <thead>
              <tr>
                <th>部门</th>
                <th>上级</th>
                <th>成员数</th>
              </tr>
            </thead>
            <tbody>
              {departments.map(d => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 500 }}>
                    <input
                      defaultValue={d.name}
                      onBlur={(e) => {
                        if (e.target.value !== d.name) {
                          void updateDepartment(d.id, {
                            name: e.target.value,
                            parentId: d.parent_id || null,
                          })
                        }
                      }}
                      style={{ minWidth: 180, marginLeft: `${(d.depth || 0) * 12}px` }}
                    />
                  </td>
                  <td style={{ color: 'var(--fg-3)' }}>
                    <select
                      value={d.parent_id || ''}
                      disabled={savingId === d.id}
                      onChange={(e) => void updateDepartment(d.id, {
                        name: d.name,
                        parentId: e.target.value || null,
                      })}
                    >
                      <option value="">（根）</option>
                      {departments
                        .filter((candidate) => candidate.id !== d.id)
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {`${'　'.repeat(candidate.depth || 0)}${candidate.name}`}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>{d.member_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === 'import' && (
        <div className="side-card" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 'var(--text-h4)', marginBottom: 12 }}>CSV 导入</h3>
          <p style={{ color: 'var(--fg-3)', marginBottom: 12, fontSize: 'var(--text-body-sm)' }}>
            格式：<code>email, display_name, title, department_code, role_codes</code>。<br />
            角色用 <code>|</code> 分隔。现在导入会走服务端创建链路，而不是浏览器直写数据库。
          </p>
          <textarea
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
            placeholder={SAMPLE_CSV}
            style={{ width: '100%', minHeight: 240, padding: 12, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-body-sm)', border: '1px solid var(--border-1)', borderRadius: 'var(--radius-md)' }}
          />
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <button
              onClick={handleImport}
              className="btn btn-primary"
              disabled={importing || !csvText.trim()}
            >
              {importing ? '导入中...' : '执行导入'}
            </button>
            <button
              onClick={() => setCsvText(SAMPLE_CSV)}
              className="btn btn-secondary"
            >
              填入示例
            </button>
          </div>
          {importResult && (
            <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)' }}>
              <p>成功：<strong style={{ color: 'var(--success-700)' }}>{importResult.ok}</strong> 条</p>
              <p>失败：<strong style={{ color: 'var(--danger-700)' }}>{importResult.fail}</strong> 条</p>
              {importResult.tempPasswords && importResult.tempPasswords.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 'var(--text-body-sm)' }}>
                  <strong>新建账号临时密码：</strong>
                  <ul>
                    {importResult.tempPasswords.map((item, idx) => <li key={idx}><code>{item}</code></li>)}
                  </ul>
                </div>
              )}
              {importResult.errors.length > 0 && (
                <ul style={{ marginTop: 8, color: 'var(--danger-700)', fontSize: 'var(--text-body-sm)' }}>
                  {importResult.errors.map((e, idx) => <li key={idx}>{e}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
