import { ShippingError } from './config'
export type WecomDepartment = { id: number; parentId: number; name: string; order: number }
export type WecomDirectoryMember = { userid: string; name: string; mobile: string; departments: string[]; departmentIds: number[]; active: boolean }
const invalid = () => new ShippingError(502, '企微组织数据不完整或冲突，现有授权保持不变。')
export function normalizeWecomDirectory(departmentInput: unknown, memberInput: unknown) {
  if (!Array.isArray(departmentInput) || !departmentInput.length || departmentInput.length > 10000 || !Array.isArray(memberInput) || memberInput.length > 100000) throw invalid()
  const seen = new Set<number>()
  const departments: WecomDepartment[] = departmentInput.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw invalid()
    const d = raw as Record<string, unknown>, id = Number(d.id), parentId = Number(d.parentid ?? 0)
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(parentId) || parentId < 0 || id === parentId || seen.has(id) || typeof d.name !== 'string' || !d.name.trim()) throw invalid()
    seen.add(id)
    return { id, parentId, name: d.name.trim(), order: Number.isFinite(Number(d.order)) ? Number(d.order) : 0 }
  })
  const byId = new Map(departments.map(d => [d.id, d]))
  for (const d of departments) {
    const ancestors = new Set([d.id]); let parent = byId.get(d.parentId)
    while (parent) { if (ancestors.has(parent.id)) throw invalid(); ancestors.add(parent.id); parent = byId.get(parent.parentId) }
  }
  const seenUsers = new Set<string>()
  const members: WecomDirectoryMember[] = memberInput.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw invalid()
    const m = raw as Record<string, unknown>
    if (typeof m.userid !== 'string' || !m.userid || m.userid.length > 256 || seenUsers.has(m.userid) || typeof m.name !== 'string' || !m.name || !Array.isArray(m.department)) throw invalid()
    seenUsers.add(m.userid)
    const departmentIds = [...new Set(m.department.map(Number))]
    if (departmentIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw invalid()
    return { userid: m.userid, name: m.name, mobile: typeof m.mobile === 'string' ? m.mobile : '', departmentIds, departments: departmentIds.map(id => byId.get(id)?.name || `部门${id}（未同步）`), active: m.status === 1 }
  })
  return { companyName: byId.get(1)?.name || '', departments, members }
}
export function authorizedDepartmentIds(departments: WecomDepartment[], selected: number[]): number[] {
  const available = new Set(departments.map(d => d.id))
  if (selected.some(id => !Number.isSafeInteger(id) || !available.has(id))) throw new ShippingError(400, '所选部门已变化，请同步组织后重新选择。')
  const result = new Set(selected)
  let changed = true
  while (changed) { changed = false; for (const d of departments) if (result.has(d.parentId) && !result.has(d.id)) { result.add(d.id); changed = true } }
  return [...result].sort((a, b) => a - b)
}
export function memberMatchesDepartments(member: Pick<WecomDirectoryMember, 'active' | 'departmentIds'>, allowed: number[]) {
  return member.active && member.departmentIds.some(id => allowed.includes(id))
}
