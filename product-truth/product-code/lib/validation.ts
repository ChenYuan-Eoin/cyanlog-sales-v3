// 参数校验层 — Zod Schema 定义
//
// 【技术选型】
// - Zod (v3.x): TypeScript-first schema validation
//   备选：Yup（React生态成熟，但类型推导弱）/ Valibot（tree-shaking更好，但生态小）/ Joi（Node.js传统，类型支持差）
//   权衡：
//   1. Zod与TypeScript深度集成，infer类型无需额外定义interface
//   2. Next.js生态主流选择，社区方案丰富
//   3. 支持.coerce自动类型转换（字符串'123'→数字123）
//   4. Bundle size比Yup小，但比Valibot大（~8KB gzipped）
//
// - 校验策略: 入参严格校验，出参信任内部代码
//   原因：
//   1. 入参来自不可信的外部（浏览器、第三方），必须防御
//   2. 出参由内部逻辑生成，重复校验增加运行时开销
//   3. 单元测试覆盖内部逻辑，替代运行时出参校验
//
// - 错误处理: 统一返回 { error: string, code: string }
//   便于前端识别错误类型，展示对应文案

import { z } from 'zod'

function optionalIntParam(defaultValue: number, options: { min: number; max?: number }) {
  const schema = z.coerce.number().int().min(options.min)
  const boundedSchema = options.max === undefined ? schema : schema.max(options.max)

  return z.preprocess(
    (value) => value === null || value === undefined || value === '' ? undefined : value,
    boundedSchema.default(defaultValue)
  )
}

// 基础验证工具
export const uuidSchema = z.string().uuid()

export const dateTimeStringSchema = z.string().refine(
  (val) => !isNaN(Date.parse(val)),
  { message: 'Invalid datetime format' }
)

// 通用分页参数
export const paginationSchema = z.object({
  page: optionalIntParam(1, { min: 1 }),
  pageSize: optionalIntParam(20, { min: 1, max: 100 }),
})

export const loginSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().regex(/^1[3-9]\d{9}$/).optional(),
  password: z.string().min(1),
}).refine(data => data.email || data.phone, {
  message: '邮箱或手机号至少填一个',
})

export const registerSchema = z.object({
  name: z.string().min(2).max(50),
  email: z.string().email().optional(),
  phone: z.string().regex(/^1[3-9]\d{9}$/).optional(),
  password: z.string().min(8).max(128),
}).refine(data => data.email || data.phone, {
  message: '邮箱或手机号至少填一个',
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '当前密码不能为空'),
  newPassword: z.string().min(8, '新密码至少8位').max(128, '新密码过长'),
}).refine((data) => data.currentPassword !== data.newPassword, {
  message: '新密码不能与当前密码相同',
  path: ['newPassword'],
})

export const quoteSchema = z.object({
  customer_name: z.string().min(1).max(255),
  customer_contact: z.string().max(255).optional(),
  valid_until: dateTimeStringSchema.optional(),
  notes: z.string().max(2000).optional(),
  discount_rate: z.number().min(0).max(100).optional().default(0),
  items: z.array(z.object({
    product_type: z.enum(['sku', 'custom']).default('sku'),
    product_id: uuidSchema.optional(),
    name: z.string().max(255).optional(),
    quantity: z.number().int().min(1),
    unit_price: z.number().nonnegative().optional(),
    discount: z.number().nonnegative().optional().default(0),
    sort_order: z.number().int().min(0).optional(),
    // F038/F044 ONES 结构化字段（可选；migration 落库后生效）
    version_code: z.string().max(20).optional(),
    deployment: z.enum(['PUBLIC_CLOUD', 'PRIVATE', 'HA']).optional(),
    auth_mode: z.enum(['SUB_YEAR', 'SUB_3YEAR', 'ONETIME']).optional(),
    term_months: z.number().int().positive().nullable().optional(),
    list_price: z.number().nonnegative().optional(),
    is_gift: z.boolean().optional().default(false),
    gift_original_amount: z.number().nonnegative().optional(),
    tax_rate: z.number().nonnegative().optional(),
    tax_amount: z.number().nonnegative().optional(),
    maintenance_months: z.number().int().nonnegative().optional(),
    version_from: z.string().max(20).optional(),
    version_to: z.string().max(20).optional(),
  }).superRefine((item, ctx) => {
    if (item.product_type === 'sku' && !item.product_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['product_id'],
        message: 'SKU 行必须选择 product_id',
      })
    }
    if (item.product_type === 'custom') {
      if (!item.name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['name'],
          message: '自定义行必须填写名称',
        })
      }
      if (item.unit_price === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['unit_price'],
          message: '自定义行必须填写单价',
        })
      }
    }
  })).min(1, '至少需要一条报价明细'),
})

export const contractIdSchema = z.object({
  id: z.string().uuid(),
})

export type LoginInput = z.infer<typeof loginSchema>
export type QuoteInput = z.infer<typeof quoteSchema>
export type PaginationInput = z.infer<typeof paginationSchema>
