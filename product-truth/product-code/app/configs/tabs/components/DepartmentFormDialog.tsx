'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { PlusIcon, BuildingIcon } from 'lucide-react'
import type { OrgSummaryDepartment, OrgSummaryUser } from '../../types'

const departmentSchema = z.object({
  name: z.string().min(1, '部门名称不能为空'),
  code: z.string().min(1, '部门编码不能为空'),
  parent_id: z.string().nullable(),
  leader_id: z.string().nullable(),
})

type DepartmentFormValues = z.infer<typeof departmentSchema>

interface DepartmentFormDialogProps {
  departments: OrgSummaryDepartment[]
  users?: OrgSummaryUser[]
  editingDept?: OrgSummaryDepartment | null
  onSubmit: (values: DepartmentFormValues) => Promise<void>
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function DepartmentFormDialog({
  departments,
  users = [],
  editingDept,
  onSubmit,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: DepartmentFormDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const onOpenChange = controlledOnOpenChange ?? setInternalOpen
  const [loading, setLoading] = useState(false)

  const form = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentSchema),
    defaultValues: {
      name: editingDept?.name ?? '',
      code: editingDept?.code ?? '',
      parent_id: editingDept?.parent_id ?? null,
      leader_id: editingDept?.leader_id ?? null,
    },
  })

  const handleSubmit = useCallback(
    async (values: DepartmentFormValues) => {
      setLoading(true)
      try {
        await onSubmit(values)
        onOpenChange(false)
        form.reset()
      } finally {
        setLoading(false)
      }
    },
    [onSubmit, form, onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger ?? (
        <Button variant="outline" size="sm">
          <PlusIcon className="h-4 w-4 mr-1" />
          添加部门
        </Button>
      )}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BuildingIcon className="h-5 w-5" />
            {editingDept ? '编辑部门' : '添加部门'}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>部门名称</FormLabel>
                  <FormControl>
                    <Input placeholder="例如：销售部" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>部门编码</FormLabel>
                  <FormControl>
                    <Input placeholder="例如：SALES" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="parent_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>上级部门</FormLabel>
                  <Select
                    value={field.value ?? 'null'}
                    onValueChange={(value) => field.onChange(value === 'null' ? null : value)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="选择上级部门（可选）" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="null">无（根部门）</SelectItem>
                      {departments.map((dept) => (
                        <SelectItem key={dept.id} value={dept.id}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="leader_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>部门主管</FormLabel>
                  <Select
                    value={field.value ?? 'null'}
                    onValueChange={(value) => field.onChange(value === 'null' ? null : value)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="选择部门主管（可选）" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="null">暂无主管</SelectItem>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.display_name} · {user.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                取消
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? '保存中...' : '保存'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
