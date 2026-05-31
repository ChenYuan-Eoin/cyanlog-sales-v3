import { z } from 'zod'

// 基础验证工具
export const uuidSchema = z.string().uuid()

export const dateTimeStringSchema = z.string().refine(
  (val) => !isNaN(Date.parse(val)),
  { message: 'Invalid datetime format' }
)

// 通用分页参数
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
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

export const quoteSchema = z.object({
  customer_name: z.string().min(1).max(255),
  customer_contact: z.string().max(255).optional(),
  valid_until: dateTimeStringSchema.optional(),
})

export const contractIdSchema = z.object({
  id: z.string().uuid(),
})

export type LoginInput = z.infer<typeof loginSchema>
export type QuoteInput = z.infer<typeof quoteSchema>
export type PaginationInput = z.infer<typeof paginationSchema>
