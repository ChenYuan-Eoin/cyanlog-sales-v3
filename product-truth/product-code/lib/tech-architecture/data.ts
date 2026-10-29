// 技术架构静态数据源
// 来源：product-truth/02-technical-truth/技术架构.md

export type ApiRoute = {
  prefix: string
  service: string
  description: string
}

export type EventType = {
  name: string
  trigger: string
  consumers: string[]
}

export type CacheLevel = {
  level: string
  tech: string
  purpose: string
  expiry: string
}

export type PerfTarget = {
  metric: string
  target: string
  note: string
}

export type SecurityConstraint = {
  area: string
  requirement: string
}

// ============ 6 类 API 路由 ============

export const apiRoutes: ApiRoute[] = [
  { prefix: '/api/auth/*', service: 'Account', description: '登录、登出、Token 刷新' },
  { prefix: '/api/quotes/*', service: '报价中心', description: '报价 CRUD、审批' },
  { prefix: '/api/contracts/*', service: '合同审核', description: '合同上传、OCR、AI 审核' },
  { prefix: '/api/configs/*', service: '配置中心', description: '规则、税率、审核配置' },
  { prefix: '/api/tenders/*', service: '标书中心', description: '招标解析、标书生成（Phase 2）' },
  { prefix: '/api/admin/*', service: '管理后台', description: '组织、用户、CSV 导入' },
]

// ============ 7 类核心事件 ============

export const eventTypes: EventType[] = [
  {
    name: 'QuoteCreated',
    trigger: '报价单创建',
    consumers: ['日程管理', '通知服务'],
  },
  {
    name: 'QuoteSent',
    trigger: '报价单发送客户',
    consumers: ['日程管理', 'CRM 同步'],
  },
  {
    name: 'QuoteConfirmed',
    trigger: '客户确认接受',
    consumers: ['合同生成', '赢单统计'],
  },
  {
    name: 'ContractUploaded',
    trigger: '合同上传',
    consumers: ['OCR 解析', '审核任务'],
  },
  {
    name: 'ContractReviewed',
    trigger: '审核完成',
    consumers: ['通知服务', '报告生成'],
  },
  {
    name: 'ApprovalRequested',
    trigger: '审批请求',
    consumers: ['通知服务', '日程管理'],
  },
  {
    name: 'ApprovalCompleted',
    trigger: '审批完成',
    consumers: ['报价状态更新', '通知服务'],
  },
]

// ============ 4 层缓存 ============

export const cacheLevels: CacheLevel[] = [
  { level: 'L1 浏览器', tech: 'Cache-Control', purpose: '静态资源', expiry: '1 年' },
  { level: 'L2 CDN', tech: 'Vercel Edge', purpose: '页面缓存', expiry: '60 秒' },
  { level: 'L3 应用', tech: 'Redis', purpose: 'API 响应', expiry: '5 分钟' },
  { level: 'L4 数据库', tech: 'PostgreSQL', purpose: '查询结果', expiry: '30 分钟' },
]

// ============ 性能目标 ============

export const perfTargets: PerfTarget[] = [
  { metric: '页面加载', target: '< 3s', note: '首屏加载时间' },
  { metric: 'API 响应', target: '< 200ms', note: '简单查询' },
  { metric: '文件上传', target: '< 10s', note: '10MB 以内' },
  { metric: 'AI 分析', target: '< 45s', note: '本地模型' },
  { metric: '并发用户', target: '50', note: '同时在线' },
]

// ============ 安全约束 ============

export const securityConstraints: SecurityConstraint[] = [
  { area: '传输', requirement: '所有通信必须 HTTPS 加密' },
  { area: '认证', requirement: 'API 请求必须携带有效 Token' },
  { area: '输入', requirement: '所有输入必须校验（Zod schema）' },
  { area: 'SQL 注入', requirement: '使用 ORM/参数化查询，禁止拼接 SQL' },
  { area: 'XSS', requirement: '输出编码，防止脚本注入' },
  { area: 'CSRF', requirement: '使用 SameSite Cookie' },
  { area: '敏感数据', requirement: '外部身份稳定映射，系统会话 token 随机生成' },
]

// ============ 服务调用模式 ============

export const callPatterns = [
  {
    name: '同步调用',
    description: '适用于需要立即响应的场景（如报价详情查询）',
    code: `const response = await fetch(\`/api/quotes/\${quoteId}\`);
return response.json();`,
  },
  {
    name: '异步调用',
    description: '适用于耗时操作（如绑定源文件与 ReviewRun 的 AI 审核）',
    code: `const task = await fetch(\`/api/contracts/\${contractId}/analyze\`, {
  method: 'POST',
  headers: { Authorization: \`Bearer \${token}\` },
});
return task.json(); // ReviewRun/job；后续读取 model_invocations、token 与计划快照证据`,
  },
  {
    name: '事件驱动',
    description: '适用于解耦场景（多消费者）',
    code: `// 生产者
await eventBus.publish('QuoteCreated', { quoteId, amount });

// 消费者
eventBus.on('QuoteCreated', async (event) => {
  await createFollowUpReminder(event.quoteId);
});`,
  },
]

// ============ 部署对比 ============

export const deploymentComparison = {
  dev: ['Next.js Dev Server (localhost:3000)', 'Supabase (localhost:54321)', 'Redis (localhost:6379)', 'MinIO (localhost:9000)', 'LM Studio (localhost:1234)'],
  prod: ['Vercel (Next.js)', 'Supabase (PostgreSQL + Auth)', 'Upstash (Redis)', 'AWS S3 (文件存储)', '公网可达 AI Gateway / Provider（RoutePolicy 路由）'],
}

// ============ 9 个章节标题 ============

export const chapterTitles = [
  { id: 'services', name: '服务间调用', icon: '⚡' },
  { id: 'gateway', name: 'API 网关', icon: '🚪' },
  { id: 'events', name: '事件总线', icon: '📨' },
  { id: 'cache', name: '缓存策略', icon: '💾' },
  { id: 'patterns', name: '调用模式', icon: '🔁' },
  { id: 'deploy', name: '部署架构', icon: '🚀' },
  { id: 'stack', name: '技术栈', icon: '🛠' },
  { id: 'targets', name: '性能目标', icon: '⏱' },
  { id: 'security', name: '安全约束', icon: '🔒' },
]
