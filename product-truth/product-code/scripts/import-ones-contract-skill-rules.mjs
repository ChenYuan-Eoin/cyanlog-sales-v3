import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

const DEFAULT_SKILL_PATH = '/tmp/ones-internal-skills/skills/ones-contract-assistant/SKILL.md'
const SOURCE_REPO = 'suoyidev/ones-internal-skills'
const SOURCE_SKILL = 'ones-contract-assistant'
const APPLICABLE_SCENARIOS = [
  'customer_contract',
  'customer_redline',
  'quote_to_contract',
  'renewal',
  'source_docx_review',
]

const RULE_META = {
  1: {
    code: 'R001',
    category: 'ratio',
    target_field: 'payment_schedule',
    clause_category: 'payment',
    field_hints: ['首期', '首付款', '预付款', '付款节奏', '账期', '尾款'],
    priority: 150,
    approval_roles: ['finance', 'legal'],
    thresholds: [['>=', 30, 'percent'], ['>=', 15, 'percent'], ['<', 15, 'percent']],
  },
  2: {
    code: 'R002',
    category: 'text',
    target_field: 'termination_refund_clause',
    clause_category: 'termination',
    field_hints: ['终止', '解除', '退款', '退还', '未消耗', '计息'],
    priority: 145,
    approval_roles: ['finance', 'legal'],
    thresholds: [['contains', 0, 'text'], ['contains', 0, 'text'], ['contains', 0, 'text']],
  },
  3: {
    code: 'R003',
    category: 'ratio',
    target_field: 'tax_rate',
    clause_category: 'tax',
    field_hints: ['税率', '增值税', '发票', '开票', '软件', 'SaaS', '维保'],
    priority: 140,
    approval_roles: ['finance'],
    thresholds: [['contains', 0, 'percent'], ['contains', 0, 'percent'], ['contains', 0, 'percent']],
  },
  4: {
    code: 'R004',
    category: 'duration',
    target_field: 'acceptance_silent_days',
    clause_category: 'acceptance',
    field_hints: ['验收', '默示验收', '视为验收', '工作日'],
    priority: 138,
    approval_roles: ['legal', 'delivery'],
    thresholds: [['<=', 10, 'day'], ['<=', 15, 'day'], ['>', 30, 'day']],
  },
  5: {
    code: 'R005',
    category: 'text',
    target_field: 'acceptance_failure_clause',
    clause_category: 'acceptance',
    field_hints: ['验收不通过', '整改', '重交', '解除', '全额退款', '间接损失'],
    priority: 136,
    approval_roles: ['legal', 'delivery'],
    thresholds: [['contains', 0, 'text'], ['contains', 0, 'text'], ['contains', 0, 'text']],
  },
  6: {
    code: 'R006',
    category: 'ratio',
    target_field: 'breach_penalty_cap',
    clause_category: 'breach',
    field_hints: ['违约金', '赔偿上限', '日违约金', '万分之五', '千分之三', '实损'],
    priority: 134,
    approval_roles: ['finance', 'legal'],
    thresholds: [['<=', 10, 'percent'], ['<=', 50, 'percent'], ['>', 100, 'percent']],
  },
  7: {
    code: 'R007',
    category: 'text',
    target_field: 'indirect_loss_clause',
    clause_category: 'liability',
    field_hints: ['间接损失', '可得利益', '商誉', '惩罚性赔偿', '一切损失'],
    priority: 132,
    approval_roles: ['legal'],
    thresholds: [['contains', 0, 'text'], ['contains', 0, 'text'], ['contains', 0, 'text']],
  },
  8: {
    code: 'R008',
    category: 'ratio',
    target_field: 'liability_cap',
    clause_category: 'liability',
    field_hints: ['责任总额', '责任上限', 'Cap', '赔偿上限', '单向'],
    priority: 130,
    approval_roles: ['finance', 'legal'],
    thresholds: [['<=', 50, 'percent'], ['<=', 100, 'percent'], ['>', 100, 'percent']],
  },
  9: {
    code: 'R009',
    category: 'duration',
    target_field: 'confidentiality_years',
    clause_category: 'confidentiality',
    field_hints: ['保密期', '保密义务', '永久', '商业秘密', '单向'],
    priority: 128,
    approval_roles: ['legal'],
    thresholds: [['<=', 7, 'year'], ['<=', 10, 'year'], ['>', 10, 'year']],
  },
  10: {
    code: 'R010',
    category: 'text',
    target_field: 'entity_payment_amount_consistency',
    clause_category: 'business_integrity',
    field_hints: ['主体', '账户', '收款', '签字', '日期', '金额', '大写', '报价单'],
    priority: 126,
    approval_roles: ['finance', 'legal'],
    thresholds: [['contains', 0, 'text'], ['contains', 0, 'text'], ['contains', 0, 'text']],
  },
  11: {
    code: 'R011',
    category: 'text',
    target_field: 'ip_ownership_clause',
    clause_category: 'ip',
    field_hints: ['知识产权', '源代码', '二次开发', '著作权', '专利', '转让'],
    priority: 124,
    approval_roles: ['legal'],
    thresholds: [['contains', 0, 'text'], ['contains', 0, 'text'], ['contains', 0, 'text']],
  },
  12: {
    code: 'R012',
    category: 'text',
    target_field: 'data_security_clause',
    clause_category: 'data_security',
    field_hints: ['客户数据', 'AI训练', '跨境', '境外', '个人信息', 'DPA', '删除'],
    priority: 122,
    approval_roles: ['legal', 'security'],
    thresholds: [['contains', 0, 'text'], ['contains', 0, 'text'], ['contains', 0, 'text']],
  },
  13: {
    code: 'R013',
    category: 'enum',
    target_field: 'sla_commitment',
    clause_category: 'sla',
    field_hints: ['SLA', '可用性', '99.5%', '99.9%', '7×24', '营业损失', '服务费'],
    priority: 120,
    approval_roles: ['delivery', 'legal'],
    thresholds: [['contains', 0, 'text'], ['contains', 0, 'text'], ['contains', 0, 'text']],
  },
  14: {
    code: 'R014',
    category: 'text',
    target_field: 'renewal_clause',
    clause_category: 'renewal',
    field_hints: ['续约', '自动续期', '自动终止', '退出权', '锁价', '涨幅'],
    priority: 118,
    approval_roles: ['sales', 'legal'],
    thresholds: [['contains', 0, 'text'], ['contains', 0, 'text'], ['contains', 0, 'text']],
  },
  15: {
    code: 'R015',
    category: 'text',
    target_field: 'dispute_resolution_clause',
    clause_category: 'dispute',
    field_hints: ['争议解决', '仲裁', '管辖', '法院', '法律', '境外'],
    priority: 116,
    approval_roles: ['legal'],
    thresholds: [['contains', 0, 'text'], ['contains', 0, 'text'], ['contains', 0, 'text']],
  },
}

function parseArgs() {
  const args = {
    apply: false,
    skillPath: process.env.ONES_CONTRACT_SKILL_PATH || DEFAULT_SKILL_PATH,
    orgId: process.env.ONES_IMPORT_ORG_ID || '',
  }

  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index]
    if (arg === '--apply') args.apply = true
    else if (arg === '--skill') {
      args.skillPath = process.argv[index + 1]
      index += 1
    } else if (arg.startsWith('--skill=')) {
      args.skillPath = arg.slice('--skill='.length)
    } else if (arg === '--org-id') {
      args.orgId = process.argv[index + 1]
      index += 1
    } else if (arg.startsWith('--org-id=')) {
      args.orgId = arg.slice('--org-id='.length)
    }
  }

  return args
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key]) continue
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
}

function parseFrontMatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  const meta = {}
  if (!match) return meta
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    meta[key] = value
  }
  return meta
}

function splitMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function parseQuickRules(content) {
  const lines = content.split(/\r?\n/)
  const start = lines.findIndex((line) => line.includes('| # |') && line.includes('条款'))
  if (start === -1) {
    throw new Error('Unable to find the quick-rule table in SKILL.md')
  }

  const rows = []
  for (let index = start + 2; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim().startsWith('|')) break
    const cells = splitMarkdownRow(line)
    const number = Number(cells[0])
    if (!Number.isFinite(number)) continue
    rows.push({
      number,
      clause: cells[1],
      levelA: cells[2],
      levelB: cells[3],
      levelC: cells[4],
    })
  }

  if (rows.length !== 15) {
    throw new Error(`Expected 15 quick rules, found ${rows.length}`)
  }
  return rows
}

function semanticPromptFor(row, sourceMeta) {
  return [
    `你是 ONES 业务运营合同审核角色，只能依据配置中心发布规则判断「${row.clause}」。`,
    `规则来源：${SOURCE_REPO}/${SOURCE_SKILL} v${sourceMeta.version || 'unknown'}，更新时间 ${sourceMeta.last_updated || 'unknown'}。`,
    `Level A 可接受：${row.levelA}`,
    `Level B 偏离可让步：${row.levelB}`,
    `红线：${row.levelC}`,
    '请输出风险等级、命中原文、判断依据、销售谈判建议、Word 批注文案，并保留规则编号与快照引用。',
  ].join('\n')
}

function buildPolicyRule(row, sourceMeta, orgId, existing) {
  const meta = RULE_META[row.number]
  if (!meta) throw new Error(`Missing rule mapping for #${row.number}`)
  const now = new Date().toISOString()
  const [[levelAOperator, levelAThreshold, levelAUnit], [levelBOperator, levelBThreshold, levelBUnit], [levelCOperator, levelCThreshold, levelCUnit]] = meta.thresholds
  const version = existing ? Number(existing.version || 1) + 1 : 1
  const source = {
    repo: SOURCE_REPO,
    skill: SOURCE_SKILL,
    version: sourceMeta.version || 'unknown',
    last_updated: sourceMeta.last_updated || 'unknown',
  }

  return {
    org_id: orgId,
    code: meta.code,
    name: row.clause,
    description: `ONES skill 条款速查：A=${row.levelA}；B=${row.levelB}；红线=${row.levelC}`,
    category: meta.category,
    applicable_scenarios: APPLICABLE_SCENARIOS,
    scope: 'org',
    level_a_operator: levelAOperator,
    level_a_threshold: levelAThreshold,
    level_a_unit: levelAUnit,
    level_a_action: 'auto_accept',
    level_b_operator: levelBOperator,
    level_b_threshold: levelBThreshold,
    level_b_unit: levelBUnit,
    level_b_action: 'negotiate_with_counterparty',
    level_b_counterparty: row.levelB === '—'
      ? '无标准让步口径；进入法务复核后再决定是否放行。'
      : '销售需围绕风险项取得对价或客户确认，并记录谈判结果。',
    level_c_operator: levelCOperator,
    level_c_threshold: levelCThreshold,
    level_c_unit: levelCUnit,
    level_c_action: 'block_or_escalate',
    level_c_message: `触发「${row.clause}」红线：${row.levelC}`,
    approval_roles: meta.approval_roles,
    engine_type: 'hybrid',
    target_field: meta.target_field,
    clause_category: meta.clause_category,
    field_hints: meta.field_hints,
    semantic_prompt: semanticPromptFor(row, source),
    message_template: {
      source,
      levels: {
        level_a: row.levelA,
        level_b: row.levelB,
        level_c: row.levelC,
      },
      outputs: {
        primary: 'word_native_comment',
        secondary: 'review_report',
        comment_author: 'ONES 业务运营',
      },
    },
    published_at: now,
    published_by: null,
    priority: meta.priority,
    is_active: true,
    version,
  }
}

const COMPARE_FIELDS = [
  'code',
  'name',
  'description',
  'category',
  'applicable_scenarios',
  'scope',
  'level_a_operator',
  'level_a_threshold',
  'level_a_unit',
  'level_a_action',
  'level_b_operator',
  'level_b_threshold',
  'level_b_unit',
  'level_b_action',
  'level_b_counterparty',
  'level_c_operator',
  'level_c_threshold',
  'level_c_unit',
  'level_c_action',
  'level_c_message',
  'approval_roles',
  'engine_type',
  'target_field',
  'clause_category',
  'field_hints',
  'semantic_prompt',
  'message_template',
  'priority',
  'is_active',
]

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    )
  }
  return value
}

function comparableValue(value) {
  if (Array.isArray(value)) return JSON.stringify(canonicalize(value))
  if (value && typeof value === 'object') return JSON.stringify(canonicalize(value))
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string' && value.match(/^-?\d+(\.\d+)?$/)) return String(Number(value))
  return value ?? null
}

function isUnchanged(existing, next) {
  if (!existing) return false
  return COMPARE_FIELDS.every((field) => (
    comparableValue(existing[field]) === comparableValue(next[field])
  ))
}

function ruleKey(row) {
  return `${row.org_id}:${row.code}`
}

async function main() {
  const cwd = process.cwd()
  loadEnvFile(path.join(cwd, '.env.local'))
  loadEnvFile(path.join(cwd, '.env'))

  const args = parseArgs()
  if (!fs.existsSync(args.skillPath)) {
    throw new Error(`SKILL.md not found at ${args.skillPath}. Clone ${SOURCE_REPO} or pass --skill /path/to/SKILL.md`)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }

  const content = fs.readFileSync(args.skillPath, 'utf8')
  const sourceMeta = parseFrontMatter(content)
  const quickRules = parseQuickRules(content)

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let orgQuery = supabase.from('organizations').select('id, name').order('name', { ascending: true })
  if (args.orgId) orgQuery = orgQuery.eq('id', args.orgId)
  const { data: organizations, error: orgError } = await orgQuery
  if (orgError) throw orgError
  if (!organizations?.length) throw new Error('No target organizations found')

  const codes = quickRules.map((row) => RULE_META[row.number].code)
  const { data: existingRows, error: existingError } = await supabase
    .from('contract_rules_v2')
    .select('*')
    .in('org_id', organizations.map((org) => org.id))
    .in('code', codes)
  if (existingError) throw existingError

  const existingByKey = new Map((existingRows || []).map((row) => [ruleKey(row), row]))
  const nextRows = []
  const skippedRows = []

  for (const org of organizations) {
    for (const quickRule of quickRules) {
      const existing = existingByKey.get(`${org.id}:${RULE_META[quickRule.number].code}`)
      const next = buildPolicyRule(quickRule, sourceMeta, org.id, existing)
      if (isUnchanged(existing, next)) skippedRows.push(next)
      else nextRows.push(next)
    }
  }

  console.log(`source=${SOURCE_REPO}/${SOURCE_SKILL} version=${sourceMeta.version || 'unknown'} rules=${quickRules.length}`)
  console.log(`organizations=${organizations.length} changed=${nextRows.length} skipped=${skippedRows.length}`)
  console.log(quickRules.map((row) => `${RULE_META[row.number].code}:${row.clause}`).join(', '))

  if (!args.apply) {
    console.log('dry-run only; rerun with --apply to write contract_rules_v2 and snapshots')
    return
  }

  if (nextRows.length === 0) {
    console.log('no rule changes to apply')
    return
  }

  const { data: upsertedRows, error: upsertError } = await supabase
    .from('contract_rules_v2')
    .upsert(nextRows, { onConflict: 'org_id,code' })
    .select('*')
  if (upsertError) throw upsertError

  const snapshots = (upsertedRows || []).map((rule) => ({
    rule_id: rule.id,
    version: rule.version || 1,
    config_snapshot: rule,
    released_by: null,
    released_at: new Date().toISOString(),
    release_note: `Imported from ${SOURCE_REPO}/${SOURCE_SKILL} v${sourceMeta.version || 'unknown'} quick rules`,
    status: 'published',
  }))

  const { error: snapshotError } = await supabase
    .from('contract_rule_snapshots')
    .insert(snapshots)
  if (snapshotError) throw snapshotError

  console.log(`applied=${upsertedRows?.length || 0} snapshots=${snapshots.length}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
