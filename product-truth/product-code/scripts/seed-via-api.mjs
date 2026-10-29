// 用 Supabase JS 客户端（service_role）直接插入所有数据
// 避免 SQL 解析问题
// 运行：node scripts/seed-via-api.mjs

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wfawwhphfqqwfwrrkogy.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SERVICE_KEY) {
  console.error('请设置 SUPABASE_SERVICE_ROLE_KEY 环境变量')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// 工具：生成 hex UUID
const id = (n) => `${n.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`

const ORG_ID = id(0x00000001)

async function main() {
  console.log('1. Organizations...')
  await supabase.from('organizations').upsert([{ id: ORG_ID, name: '华润销售集团', slug: 'huarun' }])

  console.log('2. Roles...')
  const roles = [
    { id: id(0x10000001), code: 'SUPER_ADMIN', name: '超级管理员', description: '全平台最高权限', permissions: ['*'], sort_order: 1 },
    { id: id(0x10000002), code: 'ADMIN', name: '管理员', description: '组织级管理员', permissions: ['org:*', 'user:*', 'dept:*', 'config:*', 'report:*'], sort_order: 2 },
    { id: id(0x10000003), code: 'SALES_MANAGER', name: '销售经理', description: '销售部门负责人', permissions: ['dept:view', 'opportunity:*', 'quote:approve', 'contract:view'], sort_order: 3 },
    { id: id(0x10000004), code: 'SALES', name: '销售', description: '一线销售', permissions: ['opportunity:own', 'quote:create', 'quote:update_own', 'contract:upload'], sort_order: 4 },
    { id: id(0x10000005), code: 'LEGAL', name: '法务', description: '合同审核', permissions: ['contract:review', 'contract:approve', 'template:view'], sort_order: 5 },
    { id: id(0x10000006), code: 'FINANCE', name: '财务', description: '财务相关', permissions: ['quote:view', 'contract:view', 'payment:*'], sort_order: 6 },
    { id: id(0x10000007), code: 'READONLY', name: '只读用户', description: '只读权限', permissions: ['quote:view', 'contract:view', 'customer:view'], sort_order: 99 },
  ]
  await supabase.from('roles').upsert(roles)

  console.log('3. Departments...')
  const depts = [
    { id: id(0x20000001), org_id: ORG_ID, parent_id: null, name: '销售部', code: 'SALES', sort_order: 1 },
    { id: id(0x20000002), org_id: ORG_ID, parent_id: null, name: '法务部', code: 'LEGAL', sort_order: 2 },
    { id: id(0x20000003), org_id: ORG_ID, parent_id: null, name: '财务部', code: 'FINANCE', sort_order: 3 },
    { id: id(0x20000004), org_id: ORG_ID, parent_id: null, name: '信息技术部', code: 'IT', sort_order: 4 },
    { id: id(0x20000011), org_id: ORG_ID, parent_id: id(0x20000001), name: '华东销售', code: 'EAST', sort_order: 1, leader_id: id(0x30000010) },
    { id: id(0x20000012), org_id: ORG_ID, parent_id: id(0x20000001), name: '华北销售', code: 'NORTH', sort_order: 2, leader_id: id(0x30000011) },
    { id: id(0x20000013), org_id: ORG_ID, parent_id: id(0x20000001), name: '华南销售', code: 'SOUTH', sort_order: 3, leader_id: id(0x30000012) },
    { id: id(0x20000021), org_id: ORG_ID, parent_id: id(0x20000011), name: '华东·医药行业', code: 'EAST-MED', sort_order: 1, leader_id: id(0x30000101) },
    { id: id(0x20000022), org_id: ORG_ID, parent_id: id(0x20000011), name: '华东·零售行业', code: 'EAST-RTL', sort_order: 2, leader_id: id(0x30000104) },
    { id: id(0x20000023), org_id: ORG_ID, parent_id: id(0x20000011), name: '华东·互联网行业', code: 'EAST-INT', sort_order: 3, leader_id: id(0x30000105) },
  ]
  await supabase.from('departments').upsert(depts)

  console.log('4. Users...')
  const users = [
    { id: id(0x30000001), org_id: ORG_ID, email: 'superadmin@huarun.com', display_name: '系统超管', title: '超级管理员', primary_dept_id: id(0x20000004) },
    { id: id(0x30000002), org_id: ORG_ID, email: 'admin@huarun.com', display_name: '王管理', title: '组织管理员', primary_dept_id: id(0x20000004) },
    { id: id(0x30000010), org_id: ORG_ID, email: 'east.lead@huarun.com', display_name: '李华东', title: '华东销售总监', primary_dept_id: id(0x20000011) },
    { id: id(0x30000011), org_id: ORG_ID, email: 'north.lead@huarun.com', display_name: '王华北', title: '华北销售总监', primary_dept_id: id(0x20000012) },
    { id: id(0x30000012), org_id: ORG_ID, email: 'south.lead@huarun.com', display_name: '陈华南', title: '华南销售总监', primary_dept_id: id(0x20000013) },
    { id: id(0x30000101), org_id: ORG_ID, email: 'zhang.ym@huarun.com', display_name: '张一鸣', title: '高级销售代表', primary_dept_id: id(0x20000021) },
    { id: id(0x30000102), org_id: ORG_ID, email: 'li.fy@huarun.com', display_name: '李芳颖', title: '销售代表', primary_dept_id: id(0x20000021) },
    { id: id(0x30000103), org_id: ORG_ID, email: 'wang.zy@huarun.com', display_name: '王志远', title: '销售代表', primary_dept_id: id(0x20000022) },
    { id: id(0x30000104), org_id: ORG_ID, email: 'chen.hj@huarun.com', display_name: '陈慧娟', title: '销售经理', primary_dept_id: id(0x20000022) },
    { id: id(0x30000105), org_id: ORG_ID, email: 'liu.jh@huarun.com', display_name: '刘建华', title: '销售代表', primary_dept_id: id(0x20000023) },
    { id: id(0x30000106), org_id: ORG_ID, email: 'zhao.mn@huarun.com', display_name: '赵美娜', title: '销售代表', primary_dept_id: id(0x20000023) },
    { id: id(0x30000201), org_id: ORG_ID, email: 'sun.ll@huarun.com', display_name: '孙丽丽', title: '销售代表', primary_dept_id: id(0x20000012) },
    { id: id(0x30000202), org_id: ORG_ID, email: 'ma.jf@huarun.com', display_name: '马建飞', title: '销售代表', primary_dept_id: id(0x20000012) },
    { id: id(0x30000203), org_id: ORG_ID, email: 'gao.xm@huarun.com', display_name: '高小明', title: '销售代表', primary_dept_id: id(0x20000012) },
    { id: id(0x30000204), org_id: ORG_ID, email: 'hu.jh@huarun.com', display_name: '胡建华', title: '销售经理', primary_dept_id: id(0x20000012) },
    { id: id(0x30000301), org_id: ORG_ID, email: 'guo.yf@huarun.com', display_name: '郭永福', title: '销售代表', primary_dept_id: id(0x20000013) },
    { id: id(0x30000302), org_id: ORG_ID, email: 'lin.xq@huarun.com', display_name: '林小青', title: '销售代表', primary_dept_id: id(0x20000013) },
    { id: id(0x30000303), org_id: ORG_ID, email: 'he.jm@huarun.com', display_name: '何健明', title: '销售代表', primary_dept_id: id(0x20000013) },
    { id: id(0x30000304), org_id: ORG_ID, email: 'yang.lh@huarun.com', display_name: '杨丽华', title: '销售经理', primary_dept_id: id(0x20000013) },
    { id: id(0x30000401), org_id: ORG_ID, email: 'legal01@huarun.com', display_name: '陈法务', title: '法务专员', primary_dept_id: id(0x20000002) },
    { id: id(0x30000402), org_id: ORG_ID, email: 'legal02@huarun.com', display_name: '赵法务', title: '法务主管', primary_dept_id: id(0x20000002) },
    { id: id(0x30000501), org_id: ORG_ID, email: 'finance01@huarun.com', display_name: '钱会计', title: '会计', primary_dept_id: id(0x20000003) },
    { id: id(0x30000502), org_id: ORG_ID, email: 'finance02@huarun.com', display_name: '孙出纳', title: '出纳', primary_dept_id: id(0x20000003) },
  ]
  const { error: usersErr } = await supabase.from('users').upsert(users)
  if (usersErr) console.error('Users error:', usersErr)

  console.log('5. User-Departments...')
  const userDepts = users.map(u => ({ user_id: u.id, department_id: u.primary_dept_id, is_primary: true }))
  await supabase.from('user_departments').upsert(userDepts)

  console.log('6. User-Roles...')
  const userRoles = []
  users.forEach(u => {
    let codes = []
    if (u.email === 'superadmin@huarun.com') codes = ['SUPER_ADMIN']
    else if (u.email === 'admin@huarun.com') codes = ['ADMIN']
    else if (u.title.includes('总监') || u.title.includes('经理')) codes = ['SALES_MANAGER']
    else if (u.title.includes('销售')) codes = ['SALES']
    if (u.primary_dept_id === id(0x20000002)) codes = ['LEGAL']
    if (u.primary_dept_id === id(0x20000003)) codes = ['FINANCE']

    codes.forEach(code => {
      const role = roles.find(r => r.code === code)
      if (role) {
        userRoles.push({
          user_id: u.id,
          role_id: role.id,
          scope_type: 'org',
          scope_id: null,
        })
      }
    })
  })
  await supabase.from('user_roles').upsert(userRoles)

  console.log('7. Sales Spaces...')
  const spaces = [
    { id: id(0x40000001), org_id: ORG_ID, department_id: id(0x20000011), name: '华东销售空间', description: '面向华东地区销售协同', owner_id: id(0x30000010) },
    { id: id(0x40000002), org_id: ORG_ID, department_id: id(0x20000012), name: '华北销售空间', description: '面向华北地区销售协同', owner_id: id(0x30000011) },
    { id: id(0x40000003), org_id: ORG_ID, department_id: id(0x20000013), name: '华南销售空间', description: '面向华南地区销售协同', owner_id: id(0x30000012) },
  ]
  await supabase.from('sales_spaces').upsert(spaces)

  console.log('8. Space Members...')
  const spaceMembers = []
  // 华东
  users.filter(u => [id(0x20000011), id(0x20000021), id(0x20000022), id(0x20000023)].includes(u.primary_dept_id))
    .forEach(u => spaceMembers.push({ space_id: id(0x40000001), user_id: u.id, space_role: 'MEMBER' }))
  spaceMembers.push({ space_id: id(0x40000001), user_id: id(0x30000010), space_role: 'OWNER' })
  // 华北
  users.filter(u => u.primary_dept_id === id(0x20000012))
    .forEach(u => spaceMembers.push({ space_id: id(0x40000002), user_id: u.id, space_role: 'MEMBER' }))
  spaceMembers.push({ space_id: id(0x40000002), user_id: id(0x30000011), space_role: 'OWNER' })
  // 华南
  users.filter(u => u.primary_dept_id === id(0x20000013))
    .forEach(u => spaceMembers.push({ space_id: id(0x40000003), user_id: u.id, space_role: 'MEMBER' }))
  spaceMembers.push({ space_id: id(0x40000003), user_id: id(0x30000012), space_role: 'OWNER' })
  await supabase.from('sales_space_members').upsert(spaceMembers)

  console.log('9. Customers...')
  const customers = [
    { id: id(0x50000001), org_id: ORG_ID, name: '华润万家股份有限公司', short_name: '华润万家', contact_name: '李经理', contact_phone: '13800138001', industry: '零售', region: '华东', tier: 'A', created_by: id(0x30000103) },
    { id: id(0x50000002), org_id: ORG_ID, name: '江苏省人民医院', short_name: '省人民医院', contact_name: '王主任', contact_phone: '13800138002', industry: '医疗', region: '华东', tier: 'A', created_by: id(0x30000101) },
    { id: id(0x50000003), org_id: ORG_ID, name: '阿里云华东分公司', short_name: '阿里云', contact_name: '张架构师', contact_phone: '13800138003', industry: '互联网', region: '华东', tier: 'A', created_by: id(0x30000105) },
    { id: id(0x50000004), org_id: ORG_ID, name: '北京协和医院', short_name: '协和医院', contact_name: '刘主任', contact_phone: '13800138004', industry: '医疗', region: '华北', tier: 'A', created_by: id(0x30000201) },
    { id: id(0x50000005), org_id: ORG_ID, name: '京东集团', short_name: '京东', contact_name: '陈总', contact_phone: '13800138005', industry: '互联网', region: '华北', tier: 'A', created_by: id(0x30000202) },
    { id: id(0x50000006), org_id: ORG_ID, name: '深圳腾讯', short_name: '腾讯', contact_name: '黄经理', contact_phone: '13800138006', industry: '互联网', region: '华南', tier: 'A', created_by: id(0x30000301) },
    { id: id(0x50000007), org_id: ORG_ID, name: '广州医药集团', short_name: '广药集团', contact_name: '吴总监', contact_phone: '13800138007', industry: '医疗', region: '华南', tier: 'B', created_by: id(0x30000302) },
    { id: id(0x50000008), org_id: ORG_ID, name: '永辉超市', short_name: '永辉', contact_name: '周采购', contact_phone: '13800138008', industry: '零售', region: '华东', tier: 'B', created_by: id(0x30000104) },
  ]
  await supabase.from('customers').upsert(customers)

  console.log('10. Opportunities...')
  const opportunities = [
    { id: id(0x60000001), org_id: ORG_ID, space_id: id(0x40000001), customer_id: id(0x50000002), name: '省医疗云平台招标', amount: 8500000, status: 'QUOTING', stage: '报价确认中', probability: 60, owner_id: id(0x30000101), expected_close_date: '2026-07-15' },
    { id: id(0x60000002), org_id: ORG_ID, space_id: id(0x40000001), customer_id: id(0x50000001), name: '华润万家云平台二期', amount: 12000000, status: 'CONTRACTING', stage: '合同审核中', probability: 80, owner_id: id(0x30000103), expected_close_date: '2026-06-30' },
    { id: id(0x60000003), org_id: ORG_ID, space_id: id(0x40000001), customer_id: id(0x50000008), name: '永辉超市连锁收银系统', amount: 5800000, status: 'QUALIFIED', stage: '需求确认中', probability: 40, owner_id: id(0x30000104), expected_close_date: '2026-08-20' },
    { id: id(0x60000004), org_id: ORG_ID, space_id: id(0x40000001), customer_id: id(0x50000003), name: '阿里云数据中台集成', amount: 6800000, status: 'QUOTING', stage: 'POC 阶段', probability: 50, owner_id: id(0x30000105), expected_close_date: '2026-09-01' },
    { id: id(0x60000005), org_id: ORG_ID, space_id: id(0x40000002), customer_id: id(0x50000004), name: '协和医院信息化升级', amount: 9500000, status: 'CONTRACTING', stage: '签约准备中', probability: 75, owner_id: id(0x30000201), expected_close_date: '2026-07-08' },
    { id: id(0x60000006), org_id: ORG_ID, space_id: id(0x40000002), customer_id: id(0x50000005), name: '京东企业云续约', amount: 4200000, status: 'WON', stage: '已签约', probability: 100, owner_id: id(0x30000202), expected_close_date: '2026-05-30' },
    { id: id(0x60000007), org_id: ORG_ID, space_id: id(0x40000003), customer_id: id(0x50000006), name: '腾讯云区域合作', amount: 15000000, status: 'LEAD', stage: '首次接触', probability: 20, owner_id: id(0x30000301), expected_close_date: '2026-10-15' },
    { id: id(0x60000008), org_id: ORG_ID, space_id: id(0x40000003), customer_id: id(0x50000007), name: '广药集团采购', amount: 3500000, status: 'QUOTING', stage: '报价中', probability: 45, owner_id: id(0x30000302), expected_close_date: '2026-08-10' },
  ]
  await supabase.from('opportunities').upsert(opportunities)

  console.log('11. Milestones...')
  const milestones = [
    { id: id(0x70000001), org_id: ORG_ID, opportunity_id: id(0x60000001), name: '标书准备中·待校案例', type: 'DEADLINE', status: 'IN_PROGRESS', priority: 'HIGH', due_date: '2026-06-03T17:00:00+08', owner_id: id(0x30000101) },
    { id: id(0x70000002), org_id: ORG_ID, opportunity_id: id(0x60000002), name: '报价确认中·待补交付日', type: 'REVIEW', status: 'IN_PROGRESS', priority: 'CRITICAL', due_date: '2026-06-02T18:00:00+08', owner_id: id(0x30000103) },
    { id: id(0x70000003), org_id: ORG_ID, opportunity_id: id(0x60000002), name: '合同审核中·待确认账期', type: 'REVIEW', status: 'PENDING', priority: 'NORMAL', due_date: '2026-06-04T17:00:00+08', owner_id: id(0x30000401) },
    { id: id(0x70000004), org_id: ORG_ID, opportunity_id: id(0x60000003), name: '连锁零售续约协议', type: 'SIGN', status: 'PENDING', priority: 'NORMAL', due_date: '2026-06-10T17:00:00+08', owner_id: id(0x30000104) },
    { id: id(0x70000005), org_id: ORG_ID, opportunity_id: id(0x60000005), name: '签约文件准备', type: 'SIGN', status: 'IN_PROGRESS', priority: 'HIGH', due_date: '2026-06-05T17:00:00+08', owner_id: id(0x30000201) },
    { id: id(0x70000006), org_id: ORG_ID, opportunity_id: id(0x60000006), name: '合同归档', type: 'DELIVERY', status: 'PENDING', priority: 'NORMAL', due_date: '2026-06-07T17:00:00+08', owner_id: id(0x30000202) },
    { id: id(0x70000007), org_id: ORG_ID, opportunity_id: id(0x60000007), name: '首次拜访', type: 'DEADLINE', status: 'PENDING', priority: 'HIGH', due_date: '2026-06-08T17:00:00+08', owner_id: id(0x30000301) },
    { id: id(0x70000008), org_id: ORG_ID, opportunity_id: id(0x60000008), name: '报价确认', type: 'REVIEW', status: 'IN_PROGRESS', priority: 'NORMAL', due_date: '2026-06-05T17:00:00+08', owner_id: id(0x30000302) },
  ]
  await supabase.from('milestones').upsert(milestones)

  console.log('12. Reminders...')
  const reminders = [
    { id: id(0x80000001), org_id: ORG_ID, user_id: id(0x30000101), type: 'MILESTONE', title: '省医疗云平台案例待补充', description: '标书准备中，还差 2 个医疗行业案例', priority: 'HIGH', link_type: 'OPPORTUNITY', link_id: id(0x60000001) },
    { id: id(0x80000002), org_id: ORG_ID, user_id: id(0x30000101), type: 'TODO', title: '客户信息待补', description: '省人民医院联系人职位信息缺失', priority: 'NORMAL', link_type: 'CUSTOMER', link_id: id(0x50000002) },
    { id: id(0x80000003), org_id: ORG_ID, user_id: id(0x30000103), type: 'APPROVAL', title: '合同账期待法务审核', description: '华润万家二期合同账期待法务确认', priority: 'CRITICAL', link_type: 'OPPORTUNITY', link_id: id(0x60000002) },
    { id: id(0x80000004), org_id: ORG_ID, user_id: id(0x30000103), type: 'FOLLOWUP', title: '华润万家项目交付日待确认', description: '客户期望月底前确认交付日', priority: 'HIGH', link_type: 'OPPORTUNITY', link_id: id(0x60000002) },
    { id: id(0x80000005), org_id: ORG_ID, user_id: id(0x30000105), type: 'MILESTONE', title: 'POC 阶段待启动', description: '阿里云数据中台集成 POC 待启动', priority: 'HIGH', link_type: 'OPPORTUNITY', link_id: id(0x60000004) },
    { id: id(0x80000006), org_id: ORG_ID, user_id: id(0x30000010), type: 'OVERDUE', title: '团队本周签约目标 6 单', description: '已完成 3 单，剩余 3 单待推进', priority: 'HIGH' },
    { id: id(0x80000007), org_id: ORG_ID, user_id: id(0x30000010), type: 'INFO', title: '部门 4 月简报已发布', description: '本月华东区域业绩 2,340 万，完成率 78%', priority: 'NORMAL' },
  ]
  await supabase.from('reminders').upsert(reminders)

  console.log('13. Agenda items...')
  const agendas = [
    { id: id(0x90000001), org_id: ORG_ID, user_id: id(0x30000101), title: '省人民医院标书复盘', description: '3 个项目待补：医疗案例、合同条款、POC 资料', start_time: '2026-06-02T09:30:00+08', end_time: '2026-06-02T10:30:00+08', agenda_date: '2026-06-02' },
    { id: id(0x90000002), org_id: ORG_ID, user_id: id(0x30000101), title: '标书材料校核', description: '补齐案例与附件', start_time: '2026-06-02T11:00:00+08', end_time: '2026-06-02T12:00:00+08', agenda_date: '2026-06-02' },
    { id: id(0x90000003), org_id: ORG_ID, user_id: id(0x30000103), title: '合同审核反馈', description: '确认是否进入审批', start_time: '2026-06-02T15:30:00+08', end_time: '2026-06-02T16:30:00+08', agenda_date: '2026-06-02' },
    { id: id(0x90000004), org_id: ORG_ID, user_id: id(0x30000010), title: '团队周会', description: '本周目标复盘 + 下周规划', start_time: '2026-06-02T14:00:00+08', end_time: '2026-06-02T15:00:00+08', agenda_date: '2026-06-02' },
  ]
  await supabase.from('agenda_items').upsert(agendas)

  console.log('14. Update space stats...')
  for (const spaceId of [id(0x40000001), id(0x40000002), id(0x40000003)]) {
    const { data: opps } = await supabase
      .from('opportunities')
      .select('id, status')
      .eq('space_id', spaceId)
    const active = (opps || []).filter(o => ['LEAD', 'QUALIFIED', 'QUOTING', 'CONTRACTING'].includes(o.status)).length

    const { data: mls } = await supabase
      .from('milestones')
      .select('id, status, due_date, opportunity:opportunities!inner(space_id)')
      .eq('opportunity.space_id', spaceId)
    const pending = (mls || []).filter(m => ['PENDING', 'IN_PROGRESS'].includes(m.status)).length

    await supabase
      .from('sales_spaces')
      .update({ active_opportunities: active, pending_milestones: pending })
      .eq('id', spaceId)
  }

  console.log('15. Contract review rules...')
  const rules = [
    { name: '账期超过90天', description: '付款账期超过90天为高风险', rule_type: 'structured', risk_level: 'red', enabled: true, config: { pattern: '账期\\s*[:：]?\\s*(\\d+)\\s*天', field: 'payment_term_days', operator: 'gt', value: 90 } },
    { name: '违约金比例超过5%', description: '违约金比例超过5%为中等风险', rule_type: 'structured', risk_level: 'yellow', enabled: true, config: { pattern: '违约金\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?)\\s*%', field: 'penalty_rate', operator: 'gt', value: 5 } },
    { name: '保密期超过5年', description: '保密协议期限超过5年需评审', rule_type: 'structured', risk_level: 'yellow', enabled: true, config: { pattern: '保密\\s*[:：]?\\s*(\\d+)\\s*年', field: 'confidentiality_years', operator: 'gt', value: 5 } },
    { name: '预付款超过30%', description: '预付款比例超过30%为中等风险', rule_type: 'structured', risk_level: 'yellow', enabled: true, config: { pattern: '预付\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?)\\s*%', field: 'advance_payment_rate', operator: 'gt', value: 30 } },
    { name: '未约定管辖法院', description: '合同未明确约定管辖法院', rule_type: 'structured', risk_level: 'yellow', enabled: true, config: { pattern: '管辖', field: 'jurisdiction', operator: 'eq', value: 'NOT_FOUND' } },
    { name: '未约定违约金', description: '合同未约定违约责任', rule_type: 'structured', risk_level: 'yellow', enabled: true, config: { pattern: '违约', field: 'penalty_clause', operator: 'eq', value: 'NOT_FOUND' } },
    { name: '责任划分不清晰', description: '合同中双方责任划分模糊', rule_type: 'semantic', risk_level: 'yellow', enabled: true, config: { prompt: '检查合同中"甲方""乙方"的责任描述是否清晰' } },
    { name: '知识产权归属不明', description: '未明确约定知识产权归属', rule_type: 'semantic', risk_level: 'red', enabled: true, config: { prompt: '检查合同中关于知识产权的条款' } },
    { name: '数据安全条款缺失', description: '涉及数据处理但未约定数据安全', rule_type: 'semantic', risk_level: 'red', enabled: true, config: { prompt: '识别合同中涉及数据采集、存储、传输的条款' } },
    { name: '不可抗力范围过宽', description: '不可抗力条款范围过宽可能导致免责滥用', rule_type: 'semantic', risk_level: 'yellow', enabled: true, config: { prompt: '检查不可抗力条款的范围界定' } },
  ]
  for (const [index, rule] of rules.entries()) {
    await supabase.from('rules').upsert([{
      id: id(0xA0000001 + index),
      org_id: ORG_ID,
      ...rule,
      created_by: id(0x30000001),
    }], { onConflict: 'id' })
  }
  console.log(`   seeded ${rules.length} rules`)

  console.log('16. Products...')
  const products = [
    {
      id: id(0xB0000001),
      org_id: ORG_ID,
      code: 'PROD-001',
      name: '智能合同审核系统',
      specification: '企业版',
      unit: '套',
      base_price: 98000,
      cost_price: 35000,
      min_price: 80000,
      tier_pricing_enabled: true,
      status: 'active',
      created_by: id(0x30000001),
    },
    {
      id: id(0xB0000002),
      org_id: ORG_ID,
      code: 'PROD-002',
      name: '销售管理平台',
      specification: '标准版',
      unit: '套',
      base_price: 50000,
      cost_price: 18000,
      min_price: 40000,
      tier_pricing_enabled: true,
      status: 'active',
      created_by: id(0x30000001),
    },
    {
      id: id(0xB0000003),
      org_id: ORG_ID,
      code: 'PROD-003',
      name: 'AI客服系统',
      specification: 'SaaS',
      unit: '年',
      base_price: 120000,
      cost_price: 25000,
      min_price: 90000,
      tier_pricing_enabled: true,
      status: 'active',
      created_by: id(0x30000001),
    },
  ]
  for (const p of products) {
    await supabase.from('products').upsert([p], { onConflict: 'id' })
  }
  console.log(`   seeded ${products.length} products`)

  console.log('17. Product price tiers...')
  const tiers = [
    { id: id(0xC0000001), product_id: id(0xB0000001), qty_from: 1, qty_to: 10, unit_price: 98000, sort_order: 0 },
    { id: id(0xC0000002), product_id: id(0xB0000001), qty_from: 11, qty_to: 50, unit_price: 92000, sort_order: 1 },
    { id: id(0xC0000003), product_id: id(0xB0000001), qty_from: 51, qty_to: null, unit_price: 88000, sort_order: 2 },
    { id: id(0xC0000004), product_id: id(0xB0000002), qty_from: 1, qty_to: 5, unit_price: 50000, sort_order: 0 },
    { id: id(0xC0000005), product_id: id(0xB0000002), qty_from: 6, qty_to: 20, unit_price: 47000, sort_order: 1 },
    { id: id(0xC0000006), product_id: id(0xB0000002), qty_from: 21, qty_to: null, unit_price: 45000, sort_order: 2 },
    { id: id(0xC0000007), product_id: id(0xB0000003), qty_from: 1, qty_to: 3, unit_price: 120000, sort_order: 0 },
    { id: id(0xC0000008), product_id: id(0xB0000003), qty_from: 4, qty_to: 10, unit_price: 110000, sort_order: 1 },
    { id: id(0xC0000009), product_id: id(0xB0000003), qty_from: 11, qty_to: null, unit_price: 102000, sort_order: 2 },
  ]
  for (const tier of tiers) {
    await supabase.from('product_price_tiers').upsert([tier], { onConflict: 'id' })
  }
  console.log(`   seeded ${tiers.length} product price tiers`)

  console.log('18. Contract rules v2 (managed by ONES skill migration)...')
  const { count: ruleCount, error: rulesError } = await supabase
    .from('contract_rules_v2')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', ORG_ID)
    .gte('code', 'R001')
    .lte('code', 'R015')
    .eq('is_active', true)
  if (rulesError) {
    console.error('   Error checking contract rules:', rulesError.message)
  } else {
    console.log(`   found ${ruleCount || 0}/15 active ONES skill contract rules`)
    if ((ruleCount || 0) < 15) {
      console.log('   run Supabase migrations or scripts/import-ones-contract-skill-rules.mjs --apply to import the canonical rules')
    }
  }

  console.log('Done!')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
