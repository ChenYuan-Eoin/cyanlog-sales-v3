// 业务地图静态数据源
// 来源：product-truth/01-business-truth/业务地图.md
// 状态：frozen 章节 1（系统总览）+ editable 章节（链路、状态机、规则）

export type Module = {
  id: string
  name: string
  href: string
  phase: 'current' | 'phase2'
  description: string
  icon: string
  accentColor: 'blue' | 'green' | 'purple' | 'orange' | 'rose' | 'slate'
}

export type LinkStep = {
  label: string
  description: string
  moduleId?: string
}

export type BusinessLink = {
  id: string
  name: string
  description: string
  steps: LinkStep[]
  accentColor: 'blue' | 'purple'
}

export type StateTransition = {
  from: string
  to: string
  label?: string
}

export type StateMachine = {
  id: string
  name: string
  description: string
  states: string[]
  transitions: StateTransition[]
}

// ============ 6 个核心模块 ============

export const modules: Module[] = [
  {
    id: 'account',
    name: 'Account',
    href: '/admin',
    phase: 'current',
    description: '认证、权限、组织、用户管理',
    icon: '👤',
    accentColor: 'slate',
  },
  {
    id: 'quotes',
    name: '报价中心',
    href: '/quotes',
    phase: 'current',
    description: '报价单创建、审批、发送全流程',
    icon: '¥',
    accentColor: 'blue',
  },
  {
    id: 'contracts',
    name: '合同审核',
    href: '/contracts',
    phase: 'current',
    description: '合同上传、OCR 解析、AI 审核',
    icon: '📄',
    accentColor: 'rose',
  },
  {
    id: 'configs',
    name: '配置中心',
    href: '/configs',
    phase: 'current',
    description: '红绿灯规则、税率、审核规则',
    icon: '⚙',
    accentColor: 'orange',
  },
  {
    id: 'tenders',
    name: '标书中心',
    href: '/tenders',
    phase: 'phase2',
    description: '招标文件解析、标书生成、中标跟踪',
    icon: '📋',
    accentColor: 'purple',
  },
  {
    id: 'knowledge',
    name: '知识库',
    href: '/admin',
    phase: 'phase2',
    description: '案例库、技术文档、商务资质',
    icon: '📚',
    accentColor: 'green',
  },
]

// ============ 2 条核心业务链路 ============

export const links: BusinessLink[] = [
  {
    id: 'link-main',
    name: '链路 A：报价 → 合同 → 交付',
    description: '主线流程，覆盖 80% 业务场景',
    accentColor: 'blue',
    steps: [
      { label: '线索/商机', description: '市场或销售发掘的潜在客户' },
      { label: '报价单', description: '创建报价、关联产品与价格', moduleId: 'quotes' },
      { label: '审批', description: '三级审批（销售经理→区域总监→总经理）' },
      { label: '发送客户', description: '报价单发送给客户' },
      { label: '客户确认', description: '客户确认接受报价' },
      { label: '合同', description: '签订正式合同', moduleId: 'contracts' },
      { label: '交付', description: '产品/服务交付与回款' },
    ],
  },
  {
    id: 'link-tender',
    name: '链路 B：招标文件 → 标书 → 中标',
    description: '投标链路，Phase 2 重点',
    accentColor: 'purple',
    steps: [
      { label: '招标文件', description: '客户发布的招标文档（PDF）' },
      { label: 'OCR 解析', description: 'PaddleOCR 提取关键信息', moduleId: 'tenders' },
      { label: '提取要求', description: '技术要求、资质要求、商务要求' },
      { label: '生成标书', description: '基于模板生成标书' },
      { label: '审核', description: '法务+技术双线审核' },
      { label: '提交', description: '正式提交标书' },
      { label: '中标跟踪', description: '中标结果与复盘', moduleId: 'tenders' },
    ],
  },
]

// ============ 3 个核心对象状态机 ============

export const stateMachines: StateMachine[] = [
  {
    id: 'quote',
    name: '报价单状态机',
    description: '报价从创建到关闭的完整生命周期',
    states: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'CONFIRMED', 'REJECTED'],
    transitions: [
      { from: 'DRAFT', to: 'PENDING_APPROVAL', label: '提交' },
      { from: 'PENDING_APPROVAL', to: 'APPROVED', label: '审批通过' },
      { from: 'PENDING_APPROVAL', to: 'REJECTED', label: '审批拒绝' },
      { from: 'APPROVED', to: 'SENT', label: '发送客户' },
      { from: 'SENT', to: 'CONFIRMED', label: '客户确认' },
      { from: 'SENT', to: 'REJECTED', label: '客户拒绝' },
    ],
  },
  {
    id: 'contract',
    name: '合同审核状态机',
    description: '合同上传到审核完成的全流程',
    states: ['PENDING', 'PARSING', 'ANALYZING', 'COMPLETED', 'FAILED'],
    transitions: [
      { from: 'PENDING', to: 'PARSING', label: '开始 OCR' },
      { from: 'PARSING', to: 'ANALYZING', label: 'OCR 完成' },
      { from: 'ANALYZING', to: 'COMPLETED', label: '审核完成' },
      { from: 'PARSING', to: 'FAILED', label: '解析失败' },
      { from: 'ANALYZING', to: 'FAILED', label: '审核异常' },
    ],
  },
  {
    id: 'approval',
    name: '审批单状态机',
    description: '三级审批的状态流转',
    states: ['PENDING', 'APPROVED', 'REJECTED', 'TRANSFERRED', 'TIMEOUT'],
    transitions: [
      { from: 'PENDING', to: 'APPROVED', label: '同意' },
      { from: 'PENDING', to: 'REJECTED', label: '拒绝' },
      { from: 'PENDING', to: 'TRANSFERRED', label: '转交' },
      { from: 'PENDING', to: 'TIMEOUT', label: '超时' },
    ],
  },
]

// ============ 入口独立性铁律 ============

export const entryRules = [
  {
    title: '入口独立性铁律',
    description: '每个一级入口可独立进入，不强制"必须从报价开始"',
  },
  {
    title: '三个一级入口',
    description: '报价中心、合同审核、标书中心均可独立开局',
  },
  {
    title: '对象可选关联',
    description: '报价单 ↔ 合同、标书 ↔ 报价/合同，支持反向引用',
  },
]
