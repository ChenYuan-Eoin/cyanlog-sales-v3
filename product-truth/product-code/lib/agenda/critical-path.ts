// F018 日程中心（WP11）：关键路径自动计算（CPM）
// 输入：日程项 + 依赖边（agenda 依赖 depends_on）
// 输出：关键任务集合、松弛时间、最早/最晚开始时间；依赖成环时抛出可识别错误。

export interface CriticalPathNode {
  id: string
  startAt: string
  endAt?: string | null
}

export interface CriticalPathResult {
  criticalIds: Set<string>
  slack: Map<string, number>
  earliestStart: Map<string, number>
  latestStart: Map<string, number>
  projectEnd: number
  duration: Map<string, number>
}

export class DependencyCycleError extends Error {
  cycle: string[]
  constructor(cycle: string[]) {
    super(`依赖关系存在环: ${cycle.join(' -> ')}`)
    this.name = 'DependencyCycleError'
    this.cycle = cycle
  }
}

export function nodeDuration(node: CriticalPathNode): number {
  const start = Date.parse(node.startAt)
  if (!Number.isFinite(start)) return 0
  const end = node.endAt ? Date.parse(node.endAt) : NaN
  if (Number.isFinite(end) && end > start) return Math.max(1, (end - start) / 60_000)
  return 60 // 默认 1 小时
}

export function computeCriticalPath(
  nodes: CriticalPathNode[],
  dependencies: Map<string, string[]>
): CriticalPathResult {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const duration = new Map<string, number>()
  for (const n of nodes) duration.set(n.id, nodeDuration(n))

  const pred = new Map<string, string[]>()
  const succ = new Map<string, string[]>()
  for (const id of nodes.map((n) => n.id)) {
    pred.set(id, [])
    succ.set(id, [])
  }
  for (const [id, deps] of dependencies) {
    if (!byId.has(id)) continue
    for (const dep of deps) {
      if (!byId.has(dep)) continue
      if (dep === id) throw new DependencyCycleError([id])
      pred.get(id)?.push(dep)
      succ.get(dep)?.push(id)
    }
  }

  const indegree = new Map<string, number>()
  for (const id of nodes.map((n) => n.id)) indegree.set(id, pred.get(id)?.length || 0)
  const queue = nodes.map((n) => n.id).filter((id) => (indegree.get(id) || 0) === 0)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift() as string
    order.push(id)
    for (const next of succ.get(id) || []) {
      indegree.set(next, (indegree.get(next) || 0) - 1)
      if (indegree.get(next) === 0) queue.push(next)
    }
  }
  if (order.length !== nodes.length) {
    const remaining = nodes.map((n) => n.id).filter((id) => !order.includes(id))
    throw new DependencyCycleError(remaining)
  }

  const earliestStart = new Map<string, number>()
  const earliestFinish = new Map<string, number>()
  for (const id of order) {
    const preds = pred.get(id) || []
    const es = preds.length ? Math.max(...preds.map((p) => earliestFinish.get(p) || 0)) : 0
    earliestStart.set(id, es)
    earliestFinish.set(id, es + (duration.get(id) || 0))
  }
  const projectEnd = Math.max(0, ...order.map((id) => earliestFinish.get(id) || 0))

  const latestStart = new Map<string, number>()
  for (const id of [...order].reverse()) {
    const succs = succ.get(id) || []
    const lf = succs.length ? Math.min(...succs.map((s) => latestStart.get(s) || 0)) : projectEnd
    latestStart.set(id, lf - (duration.get(id) || 0))
  }

  const slack = new Map<string, number>()
  const criticalIds = new Set<string>()
  for (const id of nodes.map((n) => n.id)) {
    const s = (latestStart.get(id) || 0) - (earliestStart.get(id) || 0)
    slack.set(id, s)
    if (s < 1e-6) criticalIds.add(id)
  }

  return { criticalIds, slack, earliestStart, latestStart, projectEnd, duration }
}
