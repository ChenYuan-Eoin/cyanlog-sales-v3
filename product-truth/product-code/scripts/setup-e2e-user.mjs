// 重置 seed 用户的密码用于 E2E 测试
// 一次性脚本

import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ 缺少 SUPABASE 环境变量')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const TEST_EMAIL = 'e2e-admin@huarun.com'
const TEST_PASSWORD = 'E2ETestPassword123!'

async function main() {
  console.log('🔐 重置 E2E 测试用户密码...')

  // 1. 查找用户
  const { data: user, error: findErr } = await supabase
    .from('users')
    .select('id')
    .eq('email', TEST_EMAIL)
    .single()

  if (findErr || !user) {
    console.log('ℹ️  用户不存在，将创建')
    const HASH = await bcrypt.hash(TEST_PASSWORD, 10)

    // 找到 super_admin role 和 IT 部门
    const { data: role } = await supabase
      .from('roles')
      .select('id')
      .eq('code', 'SUPER_ADMIN')
      .single()

    const { data: dept } = await supabase
      .from('departments')
      .select('id')
      .eq('code', 'IT')
      .single()

    if (!role || !dept) {
      console.error('❌ 找不到 SUPER_ADMIN role 或 IT 部门')
      process.exit(1)
    }

    const ORG_ID = '00000001-0000-0000-0000-000000000000'
    const USER_ID = '00030001-0000-0000-0000-000000000000'

    const { error: insertErr } = await supabase.from('users').insert({
      id: USER_ID,
      org_id: ORG_ID,
      email: TEST_EMAIL,
      display_name: 'E2E 测试管理员',
      title: 'E2E 管理员',
      primary_dept_id: dept.id,
      password_hash: HASH,
      status: 'active',
    })

    if (insertErr) {
      console.error('❌ 创建用户失败:', insertErr.message)
      process.exit(1)
    }

    // 关联 role（匹配当前组织模型）
    await supabase.from('user_roles').insert({
      user_id: USER_ID,
      role_id: role.id,
      scope_type: 'org',
      scope_id: ORG_ID,
    })

    // 关联部门
    await supabase.from('user_departments').insert({
      user_id: USER_ID,
      department_id: dept.id,
      is_primary: true,
    })

    // 关联默认组织
    await supabase.from('user_organizations').upsert({
      user_id: USER_ID,
      org_id: ORG_ID,
      is_default: true,
    }, { onConflict: 'user_id,org_id' })

    console.log(`✅ E2E 用户创建成功: ${TEST_EMAIL}`)
  } else {
    // 更新密码
    const HASH = await bcrypt.hash(TEST_PASSWORD, 10)
    const { error: updateErr } = await supabase
      .from('users')
      .update({ password_hash: HASH, must_change_password: false })
      .eq('id', user.id)

    if (updateErr) {
      console.error('❌ 更新密码失败:', updateErr.message)
      process.exit(1)
    }

    const { data: currentUser } = await supabase
      .from('users')
      .select('id, org_id')
      .eq('id', user.id)
      .single()

    if (currentUser?.org_id) {
      const { data: adminRole } = await supabase
        .from('roles')
        .select('id')
        .eq('code', 'ADMIN')
        .single()

      if (adminRole) {
        await supabase.from('user_roles').upsert({
          user_id: currentUser.id,
          role_id: adminRole.id,
          scope_type: 'org',
          scope_id: currentUser.org_id,
        }, { onConflict: 'user_id,role_id,scope_type,scope_id' })
      }

      await supabase.from('user_organizations').upsert({
        user_id: currentUser.id,
        org_id: currentUser.org_id,
        is_default: true,
      }, { onConflict: 'user_id,org_id' })
    }
    console.log(`✅ E2E 用户密码已重置: ${TEST_EMAIL}`)
  }

  console.log('')
  console.log('凭证：')
  console.log(`  email:    ${TEST_EMAIL}`)
  console.log(`  password: ${TEST_PASSWORD}`)
}

main()
