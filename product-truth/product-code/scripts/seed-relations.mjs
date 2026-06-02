// 修复 user_roles 和 sales_space_members 插入
import { createClient } from '@supabase/supabase-js'

const supabase = createClient('https://wfawwhphfqqwfwrrkogy.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmYXd3aHBoZnFxd2Z3cnJrb2d5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDAwMTMwNCwiZXhwIjoyMDk1NTc3MzA0fQ.VRvRGf55oTyfBJ38fNwujxe-MRIxQzWtp97vEKZaEsc')

const id = (n) => `${n.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`

// 拉所有用户
const { data: users } = await supabase.from('users').select('id, email, title, primary_dept_id')
const { data: roles } = await supabase.from('roles').select('id, code')
const { data: depts } = await supabase.from('departments').select('id, code, name, parent_id')

const ORG_ID = id(0x00000001)

// 为每个用户计算角色
const userRoles = []
users.forEach(u => {
  const codes = new Set()
  if (u.email === 'superadmin@huarun.com') codes.add('SUPER_ADMIN')
  else if (u.email === 'admin@huarun.com') codes.add('ADMIN')
  else if (u.title?.includes('总监') || u.title?.includes('经理')) codes.add('SALES_MANAGER')
  else if (u.title?.includes('销售')) codes.add('SALES')
  if (u.primary_dept_id === id(0x20000002)) codes.add('LEGAL')
  if (u.primary_dept_id === id(0x20000003)) codes.add('FINANCE')

  codes.forEach(code => {
    const role = roles.find(r => r.code === code)
    if (role) {
      userRoles.push({
        user_id: u.id,
        role_id: role.id,
        scope_type: 'org',
        scope_id: ORG_ID,  // 用 org_id 而不是 null
      })
    }
  })
})

// 改为 insert（不用 upsert，因为没有完全匹配 conflict 字段）
// 先清空
await supabase.from('user_roles').delete().neq('user_id', '00000000-0000-0000-0000-000000000000')
const { error: urErr } = await supabase.from('user_roles').insert(userRoles)
if (urErr) console.error('user_roles error:', urErr)
else console.log(`user_roles: ${userRoles.length} 条`)

// 销售空间成员
const spaces = [
  { id: id(0x40000001), deptIds: [id(0x20000011), id(0x20000021), id(0x20000022), id(0x20000023)], ownerId: id(0x30000010) },
  { id: id(0x40000002), deptIds: [id(0x20000012)], ownerId: id(0x30000011) },
  { id: id(0x40000003), deptIds: [id(0x20000013)], ownerId: id(0x30000012) },
]

const spaceMembers = []
spaces.forEach(s => {
  // OWNER
  spaceMembers.push({ space_id: s.id, user_id: s.ownerId, space_role: 'OWNER' })
  // MEMBERS in those depts
  users.filter(u => s.deptIds.includes(u.primary_dept_id)).forEach(u => {
    if (u.id !== s.ownerId) {
      spaceMembers.push({ space_id: s.id, user_id: u.id, space_role: 'MEMBER' })
    }
  })
})

await supabase.from('sales_space_members').delete().neq('space_id', '00000000-0000-0000-0000-000000000000')
const { error: smErr } = await supabase.from('sales_space_members').insert(spaceMembers)
if (smErr) console.error('space_members error:', smErr)
else console.log(`sales_space_members: ${spaceMembers.length} 条`)

// 验证
for (const t of ['user_roles', 'sales_space_members']) {
  const { count } = await supabase.from(t).select('*', { count: 'exact', head: true })
  console.log(`${t}: ${count}`)
}
