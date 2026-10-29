// Create a local E2E operator and a revocable application session directly.
// No local password is created. Remote Supabase targets are rejected.

import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('缺少 SUPABASE 环境变量')
  process.exit(1)
}
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(SUPABASE_URL)) {
  console.error('E2E 用户脚本仅允许本地临时 Supabase；生产唯一库 cyanlog-sales-v3 不使用该脚本')
  process.exit(1)
}

const ORG_ID = '00000001-0000-0000-0000-000000000000'
const TEST_EMAIL = 'e2e-admin@huarun.com'
const TEST_PHONE = process.env.E2E_TEST_PHONE || '+8613900000000'
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  const { data: role, error: roleError } = await supabase
    .from('roles')
    .select('id')
    .eq('code', 'SUPER_ADMIN')
    .single()
  const { data: department, error: departmentError } = await supabase
    .from('departments')
    .select('id')
    .eq('org_id', ORG_ID)
    .eq('code', 'IT')
    .single()
  if (roleError || departmentError || !role || !department) {
    console.error('本地种子缺少 SUPER_ADMIN 角色或 IT 部门')
    process.exit(1)
  }

  const { data: existing, error: findError } = await supabase
    .from('users')
    .select('id')
    .eq('org_id', ORG_ID)
    .eq('email', TEST_EMAIL)
    .maybeSingle()
  if (findError) {
    console.error('查询 E2E 用户失败:', findError.message)
    process.exit(1)
  }

  const userId = existing?.id || randomUUID()
  if (!existing) {
    const { error: insertError } = await supabase.from('users').insert({
      id: userId,
      org_id: ORG_ID,
      email: TEST_EMAIL,
      phone: TEST_PHONE,
      display_name: 'E2E 测试管理员',
      title: 'E2E 管理员',
      primary_dept_id: department.id,
      status: 'active',
      login_enabled: true,
    })
    if (insertError) {
      console.error('创建 E2E 用户失败:', insertError.message)
      process.exit(1)
    }
  } else {
    const { error: updateError } = await supabase
      .from('users')
      .update({ phone: TEST_PHONE, status: 'active', login_enabled: true })
      .eq('id', userId)
    if (updateError) {
      console.error('更新 E2E 用户失败:', updateError.message)
      process.exit(1)
    }
  }

  await supabase.from('user_roles').upsert({
    user_id: userId,
    role_id: role.id,
    org_id: ORG_ID,
    scope_type: 'org',
    scope_id: ORG_ID,
  }, { onConflict: 'user_id,role_id,scope_type,scope_id' })
  await supabase.from('user_organizations').upsert({
    user_id: userId,
    org_id: ORG_ID,
    is_default: true,
    status: 'active',
  }, { onConflict: 'user_id,org_id' })
  await supabase.from('user_departments').upsert({
    user_id: userId,
    department_id: department.id,
    is_primary: true,
  }, { onConflict: 'user_id,department_id' })

  const token = randomUUID()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const { error: tokenError } = await supabase.from('auth_tokens').insert({
    id: randomUUID(),
    token,
    user_id: userId,
    expires_at: expiresAt,
  })
  if (tokenError) {
    console.error('创建本地 E2E 会话失败:', tokenError.message)
    process.exit(1)
  }

  console.log('E2E 本地成员已就绪，无本地密码')
  console.log(`user_id: ${userId}`)
  console.log(`token: ${token}`)
  console.log(`expires_at: ${expiresAt}`)
}

void main()
