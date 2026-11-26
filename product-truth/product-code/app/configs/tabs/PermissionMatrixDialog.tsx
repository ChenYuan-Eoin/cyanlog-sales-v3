'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { RoleModulePermissionCatalog } from '@/lib/org-role-permission-readback'
import { buildRolePermissionDirectory, getDirectoryActions } from '../permission-directory'

const levels = [
  ['L1', '入口'],
  ['L2', '个人操作'],
  ['L3', '团队操作'],
  ['L4', '配置管理'],
] as const

function PermissionMatrix({ catalog }: { catalog?: RoleModulePermissionCatalog }) {
  const rows = buildRolePermissionDirectory(catalog).flatMap(group => {
    const actions = getDirectoryActions(group).filter(action => action.available && action.capabilityLevel)
    return actions.length ? [{ id: group.id, label: group.label, entry: group.entry, actions }] : []
  })
  if (!rows.length) return <p className="text-sm text-slate-600">暂未读取到已接入的权限点。</p>

  return (
    <Table className="min-w-[720px] table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">系统功能</TableHead>
          {levels.map(([level, label]) => <TableHead key={level}>{level} {label}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(row => (
          <TableRow key={row.id}>
            <th scope="row" className="p-4 text-left align-top font-medium text-slate-900">{row.label}</th>
            {levels.map(([level]) => {
              const actions = row.actions.filter(action => action.capabilityLevel === level)
              return (
                <TableCell key={level} className="whitespace-normal break-words align-top">
                  {actions.length ? (
                    <ul className="space-y-1.5 text-slate-700">
                      {actions.map(action => <li key={action.key}>{action.label}</li>)}
                    </ul>
                  ) : level === 'L1' && row.entry ? <span className="text-slate-600">随授权显示</span>
                    : <span className="text-slate-400" aria-label="无">—</span>}
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function PermissionMatrixDialog({ catalog }: { catalog?: RoleModulePermissionCatalog }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">权限矩阵</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>权限矩阵</DialogTitle>
          <DialogDescription>按系统功能查看已接入的权限点。授权在角色、部门或员工的权限设置中操作。</DialogDescription>
        </DialogHeader>
        <PermissionMatrix catalog={catalog} />
      </DialogContent>
    </Dialog>
  )
}
