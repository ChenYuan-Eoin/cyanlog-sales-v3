export type IdentityMatchMethod = 'employee_id' | 'email' | 'phone' | 'none'

export type IdentityCandidate = {
  id: string
  employeeId?: string | null
  email?: string | null
  phone?: string | null
  displayName?: string | null
  title?: string | null
  avatarUrl?: string | null
}

export type IdentityIndex = {
  byEmployeeId: Map<string, Set<string>>
  byEmail: Map<string, Set<string>>
  byPhone: Map<string, Set<string>>
}

export type IdentityResolution =
  | { kind: 'unique'; userId: string; method: IdentityMatchMethod }
  | { kind: 'none'; candidateIds: [] }
  | { kind: 'conflict'; candidateIds: string[] }

export function normalizeIdentityEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase()
  return normalized || null
}

export function normalizeIdentityPhone(value: string | null | undefined): string | null {
  const normalized = value?.replace(/[\s()-]/g, '').trim()
  return normalized || null
}

function addToIndex(index: Map<string, Set<string>>, value: string | null, userId: string) {
  if (!value) return
  const candidates = index.get(value) ?? new Set<string>()
  candidates.add(userId)
  index.set(value, candidates)
}

export function createIdentityIndex(): IdentityIndex {
  return {
    byEmployeeId: new Map(),
    byEmail: new Map(),
    byPhone: new Map(),
  }
}

export function addIdentityCandidate(index: IdentityIndex, candidate: IdentityCandidate): void {
  addToIndex(index.byEmployeeId, candidate.employeeId?.trim() || null, candidate.id)
  addToIndex(index.byEmail, normalizeIdentityEmail(candidate.email), candidate.id)
  addToIndex(index.byPhone, normalizeIdentityPhone(candidate.phone), candidate.id)
}

export function buildIdentityIndex(candidates: IdentityCandidate[]): IdentityIndex {
  const index = createIdentityIndex()
  for (const candidate of candidates) {
    addIdentityCandidate(index, candidate)
  }
  return index
}

function candidatesFor(
  map: Map<string, Set<string>>,
  value: string | null,
): Set<string> {
  return value ? map.get(value) ?? new Set<string>() : new Set<string>()
}

/**
 * Identity matching is intentionally evidence-only. Display names are never
 * inputs; one unique account may match through several evidence fields.
 */
export function resolveIdentityMatch(
  index: IdentityIndex,
  evidence: {
    employeeId?: string | null
    email?: string | null
    phone?: string | null
  },
): IdentityResolution {
  const employeeId = evidence.employeeId?.trim() || null
  const email = normalizeIdentityEmail(evidence.email)
  const phone = normalizeIdentityPhone(evidence.phone)
  const employeeCandidates = candidatesFor(index.byEmployeeId, employeeId)
  const emailCandidates = candidatesFor(index.byEmail, email)
  const phoneCandidates = candidatesFor(index.byPhone, phone)
  const candidateIds = Array.from(new Set([
    ...employeeCandidates,
    ...emailCandidates,
    ...phoneCandidates,
  ])).sort()

  if (candidateIds.length === 0) {
    return { kind: 'none', candidateIds: [] }
  }
  if (candidateIds.length > 1) {
    return { kind: 'conflict', candidateIds }
  }

  const method: IdentityMatchMethod = employeeCandidates.has(candidateIds[0])
    ? 'employee_id'
    : emailCandidates.has(candidateIds[0])
      ? 'email'
      : phoneCandidates.has(candidateIds[0])
        ? 'phone'
        : 'none'
  return { kind: 'unique', userId: candidateIds[0], method }
}

/**
 * Secondary sources may fill absent contact/profile fields, but must never
 * overwrite authoritative organization, employment or identity fields.
 */
export function secondaryEnrichmentPatch(
  existing: IdentityCandidate,
  incoming: {
    email?: string | null
    phone?: string | null
    title?: string | null
    avatarUrl?: string | null
  },
): Record<string, string> {
  const patch: Record<string, string> = {}
  const email = normalizeIdentityEmail(incoming.email)
  const phone = normalizeIdentityPhone(incoming.phone)
  if (!existing.email && email) patch.email = email
  if (!existing.phone && phone) patch.phone = phone
  if (!existing.title && incoming.title?.trim()) patch.title = incoming.title.trim()
  if (!existing.avatarUrl && incoming.avatarUrl?.trim()) patch.avatar_url = incoming.avatarUrl.trim()
  return patch
}
