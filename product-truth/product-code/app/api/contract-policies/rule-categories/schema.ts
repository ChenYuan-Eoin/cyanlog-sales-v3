import { z } from 'zod'

const PROPERTY_TYPE_CODES = new Set([
  'amount',
  'ratio',
  'duration',
  'date',
  'enum',
  'boolean',
  'text',
  'number',
  'money',
  'percentage',
])

export const problemCategoryCodeSchema = z.string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/, '分类编码只允许小写字母、数字和下划线')
  .refine((code) => !PROPERTY_TYPE_CODES.has(code), '金额、比例、时间等是规则属性类型，不能作为问题分类')

export const createProblemCategorySchema = z.object({
  // `code` is an internal stable identifier. Integrations may still provide
  // one, but business users should be able to create a category by name only.
  code: problemCategoryCodeSchema.optional(),
  name: z.string().trim().min(1, '分类名称不能为空').max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  sort_order: z.number().int().min(0).max(100_000).optional().default(100),
}).strict()

export const updateProblemCategorySchema = z.object({
  name: z.string().trim().min(1, '分类名称不能为空').max(120).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  sort_order: z.number().int().min(0).max(100_000).optional(),
  is_active: z.boolean().optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: '至少需要更新一个分类字段' }
)

export const PROBLEM_CATEGORY_SELECT = [
  'id',
  'org_id',
  'code',
  'name',
  'description',
  'sort_order',
  'is_active',
  'created_at',
  'updated_at',
].join(', ')

export function formatProblemCategoryValidationError(error: z.ZodError) {
  return error.issues.map((issue) => issue.message).join('；')
}
