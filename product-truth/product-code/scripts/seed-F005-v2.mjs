#!/usr/bin/env node
/**
 * Seed data: 12 合同模板元数据 + 15 核心规则 + 变体词典
 * F005 v2 派生实现
 *
 * Usage: node scripts/seed-F005-v2.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ 缺少 SUPABASE 环境变量')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const DEFAULT_ORG_ID = '00000001-0000-0000-0000-000000000000'

// =====================================================
// 1. 12 个合同模板元数据
// =====================================================
const TEMPLATES = [
  { name: '公有云订阅合同模板', contract_type: 'subscription', deployment: 'public_cloud', scenario: '新签', code: 'TPL-PUB-NEW' },
  { name: '私有部署一次性授权合同模板（单机版）', contract_type: 'buyout', deployment: 'private_deployment', scenario: '新签', code: 'TPL-PRV-SGL-NEW' },
  { name: '私有部署按年订阅合同模板（单机版）', contract_type: 'subscription', deployment: 'private_deployment', scenario: '新签', code: 'TPL-PRV-SGL-SUB' },
  { name: '高可用部署一次性授权合同模板', contract_type: 'buyout', deployment: 'private_deployment', scenario: '新签', code: 'TPL-HA-NEW' },
  { name: '高可用部署按年订阅合同模板', contract_type: 'subscription', deployment: 'private_deployment', scenario: '新签', code: 'TPL-HA-SUB' },
  { name: '增购续费订单模板（通用）', contract_type: 'addendum', deployment: 'any', scenario: '增购', code: 'TPL-ADD-GEN' },
  { name: '单机版一次性授权增购订单模板', contract_type: 'buyout', deployment: 'private_deployment', scenario: '增购', code: 'TPL-ADD-SGL' },
  { name: '单机版按年订阅增购续费订单模板', contract_type: 'subscription', deployment: 'private_deployment', scenario: '续约', code: 'TPL-RNW-SGL' },
  { name: '高可用一次性授权增购订单模板', contract_type: 'buyout', deployment: 'private_deployment', scenario: '增购', code: 'TPL-ADD-HA' },
  { name: '高可用按年订阅增购续费订单模板', contract_type: 'subscription', deployment: 'private_deployment', scenario: '续约', code: 'TPL-RNW-HA' },
  { name: '验收清单模板', contract_type: 'acceptance', deployment: 'any', scenario: '通用', code: 'TPL-ACC' },
  { name: 'SLA 标准售后服务内容', contract_type: 'sla', deployment: 'any', scenario: '通用', code: 'TPL-SLA' },
]

// =====================================================
// 2. 15 条核心规则（ONES 速查表，柔性化 3 级阈值）
// =====================================================
const RULES = [
  {
    code: 'PAYMENT_SCHEDULE',
    name: '付款节奏',
    category: 'payment',
    description: '首期款比例 + 尾款账期',
    lowerBound: 30, recommendedMin: 30, recommendedMax: 100, redLine: 25,
    unit: 'percent',
    approvalRoles: ['法务', '财务'],
  },
  {
    code: 'EARLY_TERMINATION_REFUND',
    name: '终止退款',
    category: 'termination',
    description: '甲方单方终止的退款规则',
    lowerBound: 0, recommendedMin: 0, recommendedMax: 30, redLine: 100,
    unit: 'percent',
    approvalRoles: ['法务', '财务'],
  },
  {
    code: 'TAX_RATE',
    name: '税率',
    category: 'tax',
    description: '软件 13% / 订阅 6%',
    lowerBound: null, recommendedMin: 6, recommendedMax: 13, redLine: null,
    unit: 'percent',
    approvalRoles: ['财务'],
  },
  {
    code: 'DEFAULT_ACCEPTANCE_PERIOD',
    name: '默示验收期',
    category: 'acceptance',
    description: '验收起止时限（5 工作日含默示）',
    lowerBound: 5, recommendedMin: 5, recommendedMax: 15, redLine: 30,
    unit: 'days',
    approvalRoles: ['法务', '售后'],
  },
  {
    code: 'ACCEPTANCE_FAILURE',
    name: '验收不通过',
    category: 'acceptance',
    description: '整改重交 / 2 次后解除 / 直接解除',
    lowerBound: 1, recommendedMin: 1, recommendedMax: 2, redLine: 99,
    unit: 'count',
    approvalRoles: ['法务'],
  },
  {
    code: 'LIQUIDATED_DAMAGES',
    name: '违约金',
    category: 'breach',
    description: '乙方赔偿上限 10%-50%；日违约金万分之五',
    lowerBound: 0, recommendedMin: 0, recommendedMax: 50, redLine: 100,
    unit: 'percent',
    approvalRoles: ['法务', '财务'],
  },
  {
    code: 'CONSEQUENTIAL_LOSS',
    name: '间接损失',
    category: 'liability',
    description: '明确排除间接/可得利益/惩罚性',
    lowerBound: 0, recommendedMin: 0, recommendedMax: 0, redLine: 1,
    unit: 'flag',
    approvalRoles: ['法务'],
  },
  {
    code: 'LIABILITY_CAP',
    name: '责任 Cap',
    category: 'liability',
    description: '≤50% 双向；50-100% 警示；>100% 红线',
    lowerBound: 0, recommendedMin: 0, recommendedMax: 50, redLine: 100,
    unit: 'percent',
    approvalRoles: ['法务', '财务'],
  },
  {
    code: 'CONFIDENTIALITY_PERIOD',
    name: '保密期',
    category: 'confidentiality',
    description: '5 年双向（3-7 年）；单向/永久红线',
    lowerBound: 3, recommendedMin: 3, recommendedMax: 7, redLine: 99,
    unit: 'years',
    approvalRoles: ['法务'],
  },
  {
    code: 'PARTY_AND_AMOUNT',
    name: '主体·收款·金额',
    category: 'general',
    description: '主体/账户/数字=大写=附件',
    lowerBound: 0, recommendedMin: 0, recommendedMax: 0, redLine: 1,
    unit: 'flag',
    approvalRoles: ['法务', '财务'],
  },
  {
    code: 'IP_OWNERSHIP',
    name: 'IP 归属',
    category: 'ip',
    description: 'ONES 保留 IP + 客户使用许可',
    lowerBound: 0, recommendedMin: 0, recommendedMax: 0, redLine: 1,
    unit: 'flag',
    approvalRoles: ['法务'],
  },
  {
    code: 'DATA_SECURITY',
    name: '数据安全',
    category: 'data',
    description: '客户数据归客户 + ONES 受限处理',
    lowerBound: 0, recommendedMin: 0, recommendedMax: 0, redLine: 1,
    unit: 'flag',
    approvalRoles: ['法务'],
  },
  {
    code: 'SLA',
    name: 'SLA',
    category: 'service',
    description: '公有云 99.5% / 99.9% 评估 / 承诺可用性红线',
    lowerBound: 99.5, recommendedMin: 99.5, recommendedMax: 99.9, redLine: 100,
    unit: 'percent',
    approvalRoles: ['法务', '售后'],
  },
  {
    code: 'RENEWAL',
    name: '续约',
    category: 'subscription',
    description: '书面续约 / 自动续期+30 日通知 / 永久锁价红线',
    lowerBound: 0, recommendedMin: 30, recommendedMax: 90, redLine: 9999,
    unit: 'days',
    approvalRoles: ['法务', '销售'],
  },
  {
    code: 'DISPUTE_RESOLUTION',
    name: '争议解决',
    category: 'general',
    description: '深圳 SCIA 仲裁 / 北京上海 / 境外红线',
    lowerBound: 0, recommendedMin: 0, recommendedMax: 1, redLine: 99,
    unit: 'flag',
    approvalRoles: ['法务'],
  },
]

// =====================================================
// 3. 变体词典（1.2 万词种子 - 从 ONES skill 推导）
// =====================================================
const VARIANT_DICTIONARY = [
  // 部署形态
  { standard: '私有部署', category: 'deployment', variant: 'Enterprise' },
  { standard: '私有部署', category: 'deployment', variant: 'On-Premise' },
  { standard: '私有部署', category: 'deployment', variant: '本地化部署' },
  { standard: '私有部署', category: 'deployment', variant: '客户机房' },
  { standard: '私有部署', category: 'deployment', variant: '自建机房' },
  { standard: '私有部署', category: 'deployment', variant: '本地化' },
  { standard: '私有部署', category: 'deployment', variant: '私有云' },
  { standard: '私有部署', category: 'deployment', variant: '企业版' },
  { standard: '私有部署', category: 'deployment', variant: '线下部署' },
  { standard: '私有部署', category: 'deployment', variant: '现场部署' },
  { standard: '私有部署', category: 'deployment', variant: 'on-prem' },
  { standard: '私有部署', category: 'deployment', variant: 'on-premise' },
  { standard: '私有部署', category: 'deployment', variant: 'self-hosted' },
  { standard: '私有部署', category: 'deployment', variant: 'private cloud' },
  { standard: '私有部署', category: 'deployment', variant: 'private deployment' },
  { standard: '公有云', category: 'deployment', variant: 'SaaS' },
  { standard: '公有云', category: 'deployment', variant: 'Cloud' },
  { standard: '公有云', category: 'deployment', variant: '云端' },
  { standard: '公有云', category: 'deployment', variant: 'ONES 云' },
  { standard: '公有云', category: 'deployment', variant: '阿里云' },
  { standard: '公有云', category: 'deployment', variant: '华为云' },
  { standard: '公有云', category: 'deployment', variant: '腾讯云' },
  { standard: '公有云', category: 'deployment', variant: '云服务' },
  { standard: '公有云', category: 'deployment', variant: '云平台' },
  { standard: '公有云', category: 'deployment', variant: '线上版本' },
  { standard: '公有云', category: 'deployment', variant: 'cloud' },
  { standard: '公有云', category: 'deployment', variant: 'cloud-based' },

  // 授权模式
  { standard: '买断', category: 'license_model', variant: '永久授权' },
  { standard: '买断', category: 'license_model', variant: '一次性购买' },
  { standard: '买断', category: 'license_model', variant: '买断式' },
  { standard: '买断', category: 'license_model', variant: '永久许可' },
  { standard: '买断', category: 'license_model', variant: '买断授权' },
  { standard: '买断', category: 'license_model', variant: '永久买断' },
  { standard: '买断', category: 'license_model', variant: 'perpetual' },
  { standard: '买断', category: 'license_model', variant: 'perpetual license' },
  { standard: '买断', category: 'license_model', variant: 'one-time purchase' },
  { standard: '买断', category: 'license_model', variant: 'outright purchase' },
  { standard: '订阅', category: 'license_model', variant: '按年付费' },
  { standard: '订阅', category: 'license_model', variant: '年费' },
  { standard: '订阅', category: 'license_model', variant: '订阅式' },
  { standard: '订阅', category: 'license_model', variant: '年订阅' },
  { standard: '订阅', category: 'license_model', variant: '续费' },
  { standard: '订阅', category: 'license_model', variant: '按月付费' },
  { standard: '订阅', category: 'license_model', variant: '月度订阅' },
  { standard: '订阅', category: 'license_model', variant: '季度付费' },
  { standard: '订阅', category: 'license_model', variant: 'subscription' },
  { standard: '订阅', category: 'license_model', variant: 'annual subscription' },
  { standard: '订阅', category: 'license_model', variant: 'monthly' },

  // 增购/续约
  { standard: '增购', category: 'lifecycle', variant: '增售' },
  { standard: '增购', category: 'lifecycle', variant: '升级' },
  { standard: '增购', category: 'lifecycle', variant: '加量' },
  { standard: '增购', category: 'lifecycle', variant: '增加账号' },
  { standard: '增购', category: 'lifecycle', variant: '扩容' },
  { standard: '增购', category: 'lifecycle', variant: '追加' },
  { standard: '增购', category: 'lifecycle', variant: 'upsize' },
  { standard: '续约', category: 'lifecycle', variant: '续签' },
  { standard: '续约', category: 'lifecycle', variant: '续订' },
  { standard: '续约', category: 'lifecycle', variant: '续费' },
  { standard: '续约', category: 'lifecycle', variant: '延期' },
  { standard: '续约', category: 'lifecycle', variant: 'renewal' },
  { standard: '续约', category: 'lifecycle', variant: 'renew' },
  { standard: '续约', category: 'lifecycle', variant: 'extension' },

  // 产品名变体（ONES V7.0）
  { standard: 'ONES Project 标准版 V7.0', category: 'product', variant: 'ONES Project' },
  { standard: 'ONES Project 标准版 V7.0', category: 'product', variant: 'Project V7.0' },
  { standard: 'ONES Project 标准版 V7.0', category: 'product', variant: 'Project管理平台' },
  { standard: 'ONES Project 标准版 V7.0', category: 'product', variant: '项目管理 V7.0' },
  { standard: 'ONES Project 专业版 V7.0', category: 'product', variant: 'Project专业版' },
  { standard: 'ONES研发管理平台标准版V7.0', category: 'product', variant: 'ONES研发管理' },
  { standard: 'ONES研发管理平台标准版V7.0', category: 'product', variant: '研发管理' },
  { standard: 'ONES研发管理平台专业版V7.0', category: 'product', variant: '研发管理专业版' },
  { standard: 'ONES研发管理平台企业版V7.0', category: 'product', variant: '研发管理企业版' },
  { standard: 'ONES研发管理平台企业版V7.0', category: 'product', variant: 'ONES R&D 企业版' },
  { standard: 'ONES Desk工单管理平台企业版V7.0', category: 'product', variant: 'ONES Desk' },
  { standard: 'ONES Desk工单管理平台企业版V7.0', category: 'product', variant: '工单管理' },
  { standard: 'ONES Desk工单管理平台企业版V7.0', category: 'product', variant: '工单系统' },

  // 高可用变体
  { standard: '高可用部署', category: 'deployment', variant: 'HA' },
  { standard: '高可用部署', category: 'deployment', variant: '高可用' },
  { standard: '高可用部署', category: 'deployment', variant: '高可用版本' },
  { standard: '高可用部署', category: 'deployment', variant: 'HA Deployment' },
  { standard: '高可用部署', category: 'deployment', variant: 'High Availability' },
  { standard: '高可用部署', category: 'deployment', variant: '集群部署' },

  // 行业术语
  { standard: '验收', category: 'process', variant: 'UAT' },
  { standard: '验收', category: 'process', variant: '用户验收' },
  { standard: '验收', category: 'process', variant: '上线验收' },
  { standard: '验收', category: 'process', variant: '初验' },
  { standard: '验收', category: 'process', variant: '终验' },
  { standard: '验收', category: 'process', variant: 'acceptance' },
  { standard: 'SLA', category: 'service', variant: '服务等级协议' },
  { standard: 'SLA', category: 'service', variant: '服务承诺' },
  { standard: 'SLA', category: 'service', variant: '可用性承诺' },
  { standard: 'SLA', category: 'service', variant: 'Service Level Agreement' },
  { standard: 'Cap', category: 'liability', variant: '责任上限' },
  { standard: 'Cap', category: 'liability', variant: '赔偿上限' },
  { standard: 'Cap', category: 'liability', variant: 'liability cap' },
  { standard: 'Cap', category: 'liability', variant: '上限封顶' },
  { standard: 'DPA', category: 'data', variant: '数据处理协议' },
  { standard: 'DPA', category: 'data', variant: 'Data Processing Agreement' },
  { standard: 'DPA', category: 'data', variant: '数据协议' },

  // 财务术语
  { standard: '账单', category: 'finance', variant: 'invoice' },
  { standard: '账单', category: 'finance', variant: '发票' },
  { standard: '账单', category: 'finance', variant: '对账单' },
  { standard: '发票', category: 'finance', variant: 'invoice' },
  { standard: '发票', category: 'finance', variant: '增值税专用发票' },
  { standard: '发票', category: 'finance', variant: '增值税普通发票' },
  { standard: '发票', category: 'finance', variant: 'VAT invoice' },
  { standard: '尾款', category: 'finance', variant: '尾款' },
  { standard: '尾款', category: 'finance', variant: 'final payment' },
  { standard: '尾款', category: 'finance', variant: '尾期款' },
  { standard: '首期款', category: 'finance', variant: '首付' },
  { standard: '首期款', category: 'finance', variant: '首期' },
  { standard: '首期款', category: 'finance', variant: '预付款' },
  { standard: '首期款', category: 'finance', variant: 'down payment' },
  { standard: '违约金', category: 'finance', variant: '罚金' },
  { standard: '违约金', category: 'finance', variant: '滞纳金' },
  { standard: '违约金', category: 'finance', variant: 'liquidated damages' },

  // 法律术语
  { standard: '管辖', category: 'legal', variant: '管辖法院' },
  { standard: '管辖', category: 'legal', variant: '争议管辖' },
  { standard: '管辖', category: 'legal', variant: 'jurisdiction' },
  { standard: '仲裁', category: 'legal', variant: 'SCIA' },
  { standard: '仲裁', category: 'legal', variant: '深圳国际仲裁院' },
  { standard: '仲裁', category: 'legal', variant: 'arbitration' },
  { standard: '保密', category: 'legal', variant: '保密义务' },
  { standard: '保密', category: 'legal', variant: '保密协议' },
  { standard: '保密', category: 'legal', variant: 'NDA' },
  { standard: '保密', category: 'legal', variant: 'confidentiality' },
  { standard: '知识产权', category: 'legal', variant: 'IP' },
  { standard: '知识产权', category: 'legal', variant: 'IP 归属' },
  { standard: '知识产权', category: 'legal', variant: 'IP rights' },
  { standard: '知识产权', category: 'legal', variant: 'intellectual property' },
  { standard: '不可抗力', category: 'legal', variant: '不可抗力条款' },
  { standard: '不可抗力', category: 'legal', variant: 'force majeure' },
]

// =====================================================
// 4. 10 个权限点
// =====================================================
const PERMISSION_POINTS = [
  { code: 'CONTRACT_ADMIN', name: '合同管理员', description: '所有合同 + 规则配置' },
  { code: 'CONTRACT_REVIEWER', name: '合同审核员', description: '本部门合同审核批注' },
  { code: 'SALES', name: '销售', description: '自己负责的客户合同' },
  { code: 'FINANCE_REVIEWER', name: '财务审核员', description: '所有财务相关合同' },
  { code: 'KNOWLEDGE_ADMIN', name: '知识库管理员', description: '所有知识库' },
  { code: 'KNOWLEDGE_VIEWER', name: '知识库阅读员', description: '只读' },
  { code: 'RULE_ADMIN', name: '规则管理员', description: '规则配置 + 维护' },
  { code: 'AI_CONFIG_ADMIN', name: 'AI 降级配置员', description: 'AI 降级策略' },
  { code: 'TEMPLATE_ADMIN', name: '模板管理员', description: '合同模板 + 变体词典' },
  { code: 'AUDIT_VIEWER', name: '审计查看员', description: '只读审计日志' },
]

// =====================================================
// 主流程
// =====================================================
async function main() {
  console.log('🌱 开始 seed F005 v2 派生数据...')

  // 1. 12 合同模板（写入 knowledge_pages）
  console.log('📄 导入 12 合同模板到 knowledge_pages...')
  for (const tpl of TEMPLATES) {
    const { error } = await supabase.from('knowledge_pages').upsert({
      org_id: DEFAULT_ORG_ID,
      title: tpl.name,
      type: 'template',
      depth: 2,
      path: `合同模板/${tpl.name}`,
      metadata: { ...tpl, source: 'ONES_skill_v2.2.2' },
      is_published: true,
      sort_order: TEMPLATES.indexOf(tpl),
    }, { onConflict: 'id' })
    if (error && !error.message.includes('duplicate')) console.error(`  ⚠️  ${tpl.name}: ${error.message}`)
  }

  // 2. 默认规则集
  console.log('📋 创建默认规则集（严格）...')
  const { data: ruleSet, error: rsErr } = await supabase.from('contract_rule_sets').upsert({
    id: '11111111-1111-1111-1111-111111111111',
    org_id: DEFAULT_ORG_ID,
    name: '默认-严格',
    code: 'STRICT_DEFAULT',
    description: '标准客户合同，底线严格',
    applicable_scenario: '默认规则集',
    is_default: true,
    is_active: true,
  }, { onConflict: 'org_id,code' }).select().single()

  if (rsErr) {
    console.error('  ⚠️ 规则集创建失败:', rsErr.message)
  } else {
    console.log(`  ✓ 规则集 ID: ${ruleSet.id}`)

    // 3. 15 条核心规则
    console.log('📏 导入 15 条核心规则...')
    for (const rule of RULES) {
      const { error } = await supabase.from('contract_rules').upsert({
        id: randomUUID(),
        rule_set_id: ruleSet.id,
        org_id: DEFAULT_ORG_ID,
        code: rule.code,
        name: rule.name,
        category: rule.category,
        description: rule.description,
        threshold_lower_bound: rule.lowerBound,
        threshold_recommended_min: rule.recommendedMin,
        threshold_recommended_max: rule.recommendedMax,
        threshold_red_line: rule.redLine,
        threshold_unit: rule.unit,
        approval_roles: rule.approvalRoles,
        is_active: true,
      }, { onConflict: 'rule_set_id,code' })
      if (error) console.error(`  ⚠️  ${rule.code}: ${error.message}`)
    }
  }

  // 4. 变体词典（本次约 130 个核心词，剩余 11870 个通过 ONES skill 推导脚本生成）
  console.log('📚 导入变体词典（核心 130 词）...')
  for (const v of VARIANT_DICTIONARY) {
    const { error } = await supabase.from('contract_variant_dictionary').upsert({
      id: randomUUID(),
      org_id: DEFAULT_ORG_ID,
      standard_term: v.standard,
      standard_category: v.category,
      variant_term: v.variant,
      variant_language: 'mixed',
      confidence: 0.9,
      source: 'ONES_skill_seed',
    }, { onConflict: 'org_id,standard_term,variant_term' })
    if (error) console.error(`  ⚠️  ${v.variant}: ${error.message}`)
  }

  // 5. 10 个权限点
  console.log('🔐 导入 10 个权限点...')
  for (const p of PERMISSION_POINTS) {
    const { error } = await supabase.from('permission_points').upsert({
      id: randomUUID(),
      code: p.code,
      name: p.name,
      description: p.description,
      scope: {},
    }, { onConflict: 'code' })
    if (error) console.error(`  ⚠️  ${p.code}: ${error.message}`)
  }

  // 6. AI 降级配置（默认）
  console.log('⚙️  AI 降级默认配置...')
  const { error: aiErr } = await supabase.from('ai_degradation_configs').upsert({
    id: '22222222-2222-2222-2222-222222222222',
    org_id: DEFAULT_ORG_ID,
    layer1_enabled: true,
    layer1_provider: 'gpt-oss-20b',
    layer1_timeout_sec: 30,
    layer2_enabled: true,
    layer2_provider: 'claude-3-5-sonnet',
    layer2_timeout_sec: 60,
    layer3_enabled: true,
    layer4_trigger: 'all_failed',
  }, { onConflict: 'org_id' })
  if (aiErr) console.error('  ⚠️ ', aiErr.message)

  console.log('✅ Seed 完成！')
  console.log('   12 合同模板 | 15 核心规则 | 130 变体词 | 10 权限点 | AI 降级配置')
  console.log('   剩余 11870 变体词由 LLM 推导脚本生成（另起脚本）')
}

main().catch((e) => {
  console.error('❌ Seed 失败:', e)
  process.exit(1)
})
