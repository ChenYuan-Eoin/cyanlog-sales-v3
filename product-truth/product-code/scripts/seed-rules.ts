/**
 * Seed: 合同审核红绿灯规则 + 基础用户数据
 *
 * 包含：
 * 1. 用户（生成正确的 bcryptjs hash）
 * 2. 合同审核规则（结构化 + 语义）
 * 3. 测试产品和报价
 *
 * 运行：
 *   export SUPABASE_SERVICE_ROLE_KEY=xxx
 *   pnpm tsx scripts/seed-rules.ts
 * 或：
 *   node --import tsx scripts/seed-rules.ts
 */

import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wfawwhphfqqwfwrrkogy.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SERVICE_KEY) {
  console.error('❌ 请设置 SUPABASE_SERVICE_ROLE_KEY 环境变量')
  console.error('   export SUPABASE_SERVICE_ROLE_KEY=eyJ...')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// UUID 工具：基于数字生成稳定 UUID
const id = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`

const ORG_ID = id(0x00000001)

async function main() {
  console.log('🌱 Seed: 合同规则 + 测试数据')
  console.log('================================')

  // 1. 生成正确的 bcrypt hash（避免 seed.sql 旧 hash 不匹配）
  const password = 'Cyanlog2026!'
  const hash = await bcrypt.hash(password, 10)
  console.log(`\n1. 生成密码 hash: ${password}`)
  console.log(`   bcrypt hash: ${hash.substring(0, 30)}...`)

  // 2. 测试超级管理员账号
  console.log('\n2. 创建测试账号（superadmin@huarun.com）...')
  const { error: userError } = await supabase
    .from('users')
    .upsert([{
      id: id(0xa0000001),
      org_id: ORG_ID,
      email: 'superadmin@huarun.com',
      display_name: '测试超管',
      title: '超级管理员',
      primary_dept_id: null,
      password_hash: hash,
      must_change_password: false,
    }])
  if (userError) {
    console.error('   ❌ 用户创建失败:', userError.message)
  } else {
    console.log('   ✅ 超级管理员账号已就绪')
  }

  // 3. 红绿灯规则 - 结构化规则
  console.log('\n3. 录入红绿灯结构化规则...')
  const structuredRules = [
    {
      name: '账期超过90天',
      description: '付款账期超过90天为高风险',
      rule_type: 'structured',
      risk_level: 'red',
      enabled: true,
      config: {
        pattern: '账期\\s*[:：]?\\s*(\\d+)\\s*天',
        field: 'payment_term_days',
        operator: 'gt',
        value: 90,
        suggestion: '建议账期不超过60天',
      },
    },
    {
      name: '违约金比例超过5%',
      description: '违约金比例超过5%为中等风险',
      rule_type: 'structured',
      risk_level: 'yellow',
      enabled: true,
      config: {
        pattern: '违约金\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?)\\s*%',
        field: 'penalty_rate',
        operator: 'gt',
        value: 5,
        suggestion: '建议违约金不超过5%',
      },
    },
    {
      name: '保密期超过5年',
      description: '保密协议期限超过5年需评审',
      rule_type: 'structured',
      risk_level: 'yellow',
      enabled: true,
      config: {
        pattern: '保密\\s*[:：]?\\s*(\\d+)\\s*年',
        field: 'confidentiality_years',
        operator: 'gt',
        value: 5,
        suggestion: '建议保密期不超过3年',
      },
    },
    {
      name: '预付款超过30%',
      description: '预付款比例超过30%为中等风险',
      rule_type: 'structured',
      risk_level: 'yellow',
      enabled: true,
      config: {
        pattern: '预付\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?)\\s*%',
        field: 'advance_payment_rate',
        operator: 'gt',
        value: 30,
        suggestion: '建议预付款不超过30%',
      },
    },
    {
      name: '未约定管辖法院',
      description: '合同未明确约定管辖法院',
      rule_type: 'structured',
      risk_level: 'yellow',
      enabled: true,
      config: {
        pattern: '管辖',
        field: 'jurisdiction',
        operator: 'eq',
        value: 'NOT_FOUND',
        suggestion: '建议约定争议管辖法院',
      },
    },
    {
      name: '未约定违约金',
      description: '合同未约定违约责任',
      rule_type: 'structured',
      risk_level: 'yellow',
      enabled: true,
      config: {
        pattern: '违约',
        field: 'penalty_clause',
        operator: 'eq',
        value: 'NOT_FOUND',
        suggestion: '建议添加违约金条款',
      },
    },
  ]

  for (const rule of structuredRules) {
    const { error } = await supabase
      .from('rules')
      .upsert([{ ...rule, created_by: id(0xa0000001) }], { onConflict: 'name' })

    if (error) {
      console.error(`   ❌ ${rule.name}: ${error.message}`)
    } else {
      console.log(`   ✅ ${rule.name} (${rule.risk_level})`)
    }
  }

  // 4. 红绿灯规则 - 语义规则
  console.log('\n4. 录入红绿灯语义规则...')
  const semanticRules = [
    {
      name: '责任划分不清晰',
      description: '合同中双方责任划分模糊',
      rule_type: 'semantic',
      risk_level: 'yellow',
      enabled: true,
      config: {
        prompt: '检查合同中"甲方""乙方"的责任描述是否清晰，识别"双方协商""另行约定"等模糊表述',
        examples: ['双方协商解决', '具体事宜另行约定', '未尽事宜双方协商'],
      },
    },
    {
      name: '知识产权归属不明',
      description: '未明确约定知识产权归属',
      rule_type: 'semantic',
      risk_level: 'red',
      enabled: true,
      config: {
        prompt: '检查合同中关于知识产权的条款，识别归属、许可、转让等关键表述',
        examples: ['知识产权归属', '技术成果', '专利申请权'],
      },
    },
    {
      name: '数据安全条款缺失',
      description: '涉及数据处理但未约定数据安全',
      rule_type: 'semantic',
      risk_level: 'red',
      enabled: true,
      config: {
        prompt: '识别合同中涉及数据采集、存储、传输的条款，检查是否有数据安全与隐私保护约定',
        examples: ['数据安全', '个人信息', '隐私保护', '数据脱敏'],
      },
    },
    {
      name: '不可抗力范围过宽',
      description: '不可抗力条款范围过宽可能导致免责滥用',
      rule_type: 'semantic',
      risk_level: 'yellow',
      enabled: true,
      config: {
        prompt: '检查不可抗力条款的范围界定，识别过宽或过窄的表述',
        examples: ['不可抗力', '免责事由', '情势变更'],
      },
    },
  ]

  for (const rule of semanticRules) {
    const { error } = await supabase
      .from('rules')
      .upsert([{ ...rule, created_by: id(0xa0000001) }], { onConflict: 'name' })

    if (error) {
      console.error(`   ❌ ${rule.name}: ${error.message}`)
    } else {
      console.log(`   ✅ ${rule.name} (${rule.risk_level})`)
    }
  }

  // 5. 测试产品数据
  console.log('\n5. 录入测试产品...')
  const products = [
    {
      code: 'PROD-001',
      name: '智能合同审核系统',
      specification: '企业版',
      unit: '套',
      base_price: 98000,
      cost_price: 35000,
      min_price: 80000,
      status: 'active',
    },
    {
      code: 'PROD-002',
      name: '销售管理平台',
      specification: '标准版',
      unit: '套',
      base_price: 50000,
      cost_price: 18000,
      min_price: 40000,
      status: 'active',
    },
    {
      code: 'PROD-003',
      name: 'AI客服系统',
      specification: 'SaaS',
      unit: '年',
      base_price: 120000,
      cost_price: 25000,
      min_price: 90000,
      status: 'active',
    },
  ]

  for (const product of products) {
    const { error } = await supabase
      .from('products')
      .upsert([product], { onConflict: 'code' })

    if (error) {
      console.error(`   ❌ ${product.name}: ${error.message}`)
    } else {
      console.log(`   ✅ ${product.name} (¥${product.base_price.toLocaleString()})`)
    }
  }

  // 6. 验证
  console.log('\n6. 验证 Seed 结果...')
  const { count: userCount } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
  const { count: ruleCount } = await supabase
    .from('rules')
    .select('*', { count: 'exact', head: true })
  const { count: productCount } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })

  console.log(`   users: ${userCount}`)
  console.log(`   rules: ${ruleCount}`)
  console.log(`   products: ${productCount}`)

  console.log('\n================================')
  console.log('✅ Seed 完成')
  console.log('\n📝 测试账号:')
  console.log(`   邮箱: superadmin@huarun.com`)
  console.log(`   密码: ${password}`)
  console.log('\n🚀 启动应用: pnpm dev')
  console.log('   访问: http://localhost:3000/login')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Seed 失败:', e)
    process.exit(1)
  })
