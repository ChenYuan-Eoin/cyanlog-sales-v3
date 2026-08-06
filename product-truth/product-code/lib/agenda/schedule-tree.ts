// F018 日程中心（WP11）：任务树构建与折叠展平（无 JSX 依赖，便于单测）
import type { AgendaItem } from './types'

export const DAY_MS = 86_400_000
export const WD = ['日', '一', '二', '三', '四', '五', '六']

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function startOfDay(iso: string): number {
  const d = new Date(iso)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function daySpan(item: AgendaItem): [number, number] {
  const start = startOfDay(item.start_at)
  const end = item.end_at ? startOfDay(item.end_at) : start
  return [start, Math.max(start, end)]
}

export interface TreeNode {
  item: AgendaItem
  children: TreeNode[]
  depth: number
}

export function buildTree(items: AgendaItem[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  for (const item of items) byId.set(item.id, { item, children: [], depth: 0 })
  const roots: TreeNode[] = []
  for (const item of items) {
    const node = byId.get(item.id)
    if (!node) continue
    const parent = item.parent_id ? byId.get(item.parent_id) : null
    if (parent) {
      node.depth = parent.depth + 1
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortByStart = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Date.parse(a.item.start_at) - Date.parse(b.item.start_at))
    nodes.forEach((n) => sortByStart(n.children))
  }
  sortByStart(roots)
  return roots
}

export function flattenVisible(
  nodes: TreeNode[],
  collapsed: Set<string>,
  out: TreeNode[] = []
): TreeNode[] {
  for (const node of nodes) {
    out.push(node)
    if (!collapsed.has(node.item.id)) flattenVisible(node.children, collapsed, out)
  }
  return out
}
