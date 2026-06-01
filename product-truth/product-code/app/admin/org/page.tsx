'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

interface UserRow {
  id: string
  email: string
  display_name: string
  title: string
  primary_dept_name: string
  role_names: string
  status: string
}

interface DepartmentRow {
  id: string
  name: string
  parent_name: string | null
  member_count: number
}

const SAMPLE_CSV = `email,display_name,title,department_code,role_codes
zhang.ym@huarun.com,张一鸣,高级销售代表,EAST-MED,SALES
li.fy@huarun.com,李芳颖,销售代表,EAST-MED,SALES
wang.zy@huarun.com,王志远,销售代表,EAST-RTL,SALES
chen.hj@huarun.com,陈慧娟,销售经理,EAST-RTL,SALES_MANAGER
`;

export default function OrgAdminPage() {
  const router = useRouter()
  const [tab, setTab] = useState<'users' | 'departments' | 'import'>('users')
  const [users, setUsers] = useState<UserRow[]>([])
  const [departments, setDepartments] = useState<DepartmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [csvText, setCsvText] = useState('')
  const [importResult, setImportResult] = useState<{ ok: number; fail: number; errors: string[] } | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.push('/login')
        return
      }
      // 检查权限（仅 ADMIN/SUPER_ADMIN）
      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('role:roles(code)')
        .eq('user_id', user.id)

      const codes = (userRoles || []).map((r: { role: { code: string } | { code: string }[] }) =>
        Array.isArray(r.role) ? r.role[0]?.code : r.role?.code
      )
      if (!codes.includes('ADMIN') && !codes.includes('SUPER_ADMIN')) {
        alert('无权限访问组织管理')
        router.push('/')
        return
      }
      await loadData()
    })
  }, [router])

  async function loadData() {
    setLoading(true)
    try {
      // 加载用户
      const { data: usersData } = await supabase
        .from('users')
        .select('id, email, display_name, title, status, primary_dept:departments!primary_dept_id(name), user_roles(role:roles(name))')
        .order('created_at', { ascending: false })
        .limit(100)

      const u: UserRow[] = (usersData || []).map((row: {
        id: string
        email: string | null
        display_name: string
        title: string | null
        status: string
        primary_dept: { name: string } | { name: string }[] | null
        user_roles: { role: { name: string } | { name: string }[] }[]
      }) => ({
        id: row.id,
        email: row.email || '',
        display_name: row.display_name,
        title: row.title || '',
        primary_dept_name: Array.isArray(row.primary_dept) ? row.primary_dept[0]?.name : row.primary_dept?.name || '-',
        role_names: (row.user_roles || [])
          .map(r => Array.isArray(r.role) ? r.role[0]?.name : r.role?.name)
          .filter(Boolean)
          .join(', '),
        status: row.status,
      }))
      setUsers(u)

      // 加载部门
      const { data: depts } = await supabase
        .from('departments')
        .select('id, name, member_count, parent:departments!parent_id(name)')
        .order('depth', { ascending: true })
        .order('sort_order', { ascending: true })

      const d: DepartmentRow[] = (depts || []).map((row: {
        id: string
        name: string
        member_count: number
        parent: { name: string } | { name: string }[] | null
      }) => ({
        id: row.id,
        name: row.name,
        member_count: row.member_count,
        parent_name: Array.isArray(row.parent) ? row.parent[0]?.name : row.parent?.name || null,
      }))
      setDepartments(d)
    } catch (e) {
      console.error('[OrgAdmin] load error', e)
    } finally {
      setLoading(false)
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

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim())
      const row: Record<string, string> = {}
      header.forEach((h, idx) => row[h] = cols[idx] || '')

      try {
        // 找部门
        const { data: dept } = await supabase
          .from('departments')
          .select('id')
          .eq('code', row.department_code)
          .single()

        if (!dept) {
          errors.push(`第 ${i} 行: 部门代码 ${row.department_code} 不存在`)
          fail++
          continue
        }

        // 创建或更新用户
        const { data: existing } = await supabase
          .from('users')
          .select('id')
          .eq('email', row.email)
          .single()

        let userId: string
        if (existing) {
          userId = existing.id
          await supabase
            .from('users')
            .update({
              display_name: row.display_name,
              title: row.title || null,
              primary_dept_id: dept.id,
            })
            .eq('id', userId)
        } else {
          // 密码默认 password123 (生产环境应要求首次登录修改)
          const DEFAULT_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
          const { data: created, error: createErr } = await supabase
            .from('users')
            .insert({
              email: row.email,
              display_name: row.display_name,
              title: row.title || null,
              primary_dept_id: dept.id,
              password_hash: DEFAULT_HASH,
              status: 'active',
            })
            .select('id')
            .single()

          if (createErr || !created) {
            errors.push(`第 ${i} 行: 创建用户失败 - ${createErr?.message}`)
            fail++
            continue
          }
          userId = created.id

          // 关联部门
          await supabase
            .from('user_departments')
            .insert({ user_id: userId, department_id: dept.id, is_primary: true })
        }

        // 关联角色
        if (row.role_codes) {
          const roleCodes = row.role_codes.split(/[|;]/).map(r => r.trim()).filter(Boolean)
          for (const code of roleCodes) {
            const { data: role } = await supabase
              .from('roles')
              .select('id')
              .eq('code', code)
              .single()

            if (role) {
              await supabase
                .from('user_roles')
                .upsert({
                  user_id: userId,
                  role_id: role.id,
                  scope_type: 'org',
                  scope_id: null,
                }, { onConflict: 'user_id,role_id,scope_type,scope_id' })
            }
          }
        }

        ok++
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        errors.push(`第 ${i} 行: ${msg}`)
        fail++
      }
    }

    setImportResult({ ok, fail, errors })
    setImporting(false)
    await loadData()
  }

  return (
    <div className="content-area" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="breadcrumb">
        <Link href="/" className="breadcrumb-current">首页</Link> / 组织管理
      </div>
      <h1>组织管理</h1>
      <p className="subtitle">维护组织架构、用户、角色。导入后所有功能自动可用。</p>

      {/* Tab 切换 */}
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

      {/* Users tab */}
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
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 500 }}>{u.display_name}</td>
                  <td style={{ color: 'var(--fg-3)' }}>{u.email}</td>
                  <td>{u.title}</td>
                  <td>{u.primary_dept_name}</td>
                  <td style={{ fontSize: 'var(--text-caption)' }}>{u.role_names || '-'}</td>
                  <td>
                    <span className={u.status === 'active' ? 'pill success' : 'pill outline'}>
                      {u.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Departments tab */}
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
                  <td style={{ fontWeight: 500 }}>{d.name}</td>
                  <td style={{ color: 'var(--fg-3)' }}>{d.parent_name || '（根）'}</td>
                  <td>{d.member_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Import tab */}
      {!loading && tab === 'import' && (
        <div className="side-card" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 'var(--text-h4)', marginBottom: 12 }}>CSV 导入</h3>
          <p style={{ color: 'var(--fg-3)', marginBottom: 12, fontSize: 'var(--text-body-sm)' }}>
            格式：<code>email, display_name, title, department_code, role_codes</code>。<br />
            角色用 <code>|</code> 分隔。新用户默认密码 <code>password123</code>。
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
