import { z } from 'zod'

export const departmentOverrideChoice = z.enum(['new_baseline', 'retain_eligible'])
export type DepartmentOverrideChoice = z.infer<typeof departmentOverrideChoice>

const guid = z.guid().transform(value => value.toLowerCase())

export const departmentSaveChoiceFields = {
  request_id: guid.optional(),
  override_choice: departmentOverrideChoice.optional(),
  choice_id: guid.optional(),
}

export function hasCompleteDepartmentOverrideChoice(value: { choice_id?: string; override_choice?: DepartmentOverrideChoice }) {
  return Boolean(value.choice_id) === Boolean(value.override_choice)
}

export const departmentOverrideChoiceRequired = z.object({
  status: z.literal('override_choice_required'),
  choice_id: z.guid(),
  impact: z.object({
    affected_count: z.number().int().positive(),
    retainable_count: z.number().int().nonnegative(),
    blocked_count: z.number().int().nonnegative(),
  }).refine(impact => impact.retainable_count <= impact.affected_count && impact.blocked_count <= impact.affected_count),
})
