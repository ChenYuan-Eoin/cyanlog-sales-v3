import { z } from 'zod'

export const roleOverrideDecisionSchema = z.object({
  review_revision: z.guid(),
  choice: z.enum(['new_baseline', 'retain_eligible']),
})

const reviewSchema = z.object({
  review_revision: z.guid(),
  affected_permissions: z.array(z.object({ permission_code: z.string(), retainable: z.boolean() })).min(1),
})

export type RoleOverrideDecision = z.infer<typeof roleOverrideDecisionSchema>
export type RoleOverrideReview = z.infer<typeof reviewSchema>

export const ROLE_PERMISSION_REVIEW_REQUIRED = 'ROLE_PERMISSION_REVIEW_REQUIRED'

export function readRoleOverrideReview(result: unknown): RoleOverrideReview | undefined {
  const parsed = reviewSchema.safeParse(result)
  return parsed.success ? parsed.data : undefined
}

export function roleMutationResult(result: unknown): unknown {
  return result && typeof result === 'object' && 'result' in result ? result.result : undefined
}
