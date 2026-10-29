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
import { Checkbox } from '@/components/ui/checkbox'
import { PlusIcon, UserIcon, EditIcon } from 'lucide-react'
import type { OrgSummaryUser, OrgSummaryDepartment } from '../../types'

const userSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
  phone: z.string().min(1, '手机号不能为空'),
  display_name: z.string().min(1, '姓名不能为空'),
  title: z.string().optional(),
  primary_dept_id: z.string().nullable(),
  role_ids: z.array(z.string()).optional(),
})

type UserFormValues = z.infer<typeof userSchema>

interface UserFormDialogProps {
  departments: OrgSummaryDepartment[]
  roles?: Array<{ id: string; name: string; code: string }>
  editingUser?: OrgSummaryUser | null
  onSubmit: (values: UserFormValues & { role_ids?: string[] }) => Promise<void>
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function UserFormDialog({
  departments,
  roles = [],
  editingUser,
  onSubmit,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: UserFormDialogProps) {
  const assignableRoles = roles.filter((role) => role.code !== 'SUPER_ADMIN')
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const onOpenChange = controlledOnOpenChange ?? setInternalOpen
  const [loading, setLoading] = useState(false)

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      email: editingUser?.email ?? '',
      phone: editingUser?.phone ?? '',
      display_name: editingUser?.display_name ?? '',
      title: editingUser?.title ?? '',
      primary_dept_id: editingUser?.primary_dept_id ?? null,
      role_ids: editingUser?.role_ids ?? [],
    },
  })

  const handleSubmit = useCallback(
    async (values: UserFormValues) => {
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
          {editingUser ? (
            <>
              <EditIcon className="h-4 w-4 mr-1" />
              编辑成员
            </>
          ) : (
            <>
              <PlusIcon className="h-4 w-4 mr-1" />
              添加成员
            </>
          )}
        </Button>
      )}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserIcon className="h-5 w-5" />
            {editingUser ? '编辑成员' : '添加成员'}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>邮箱</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="例如：zhangsan@company.com"
                      {...field}
                      disabled={!!editingUser}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>手机号</FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      placeholder="例如：13900000000"
                      autoComplete="tel"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="display_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>姓名</FormLabel>
                  <FormControl>
                    <Input placeholder="例如：张三" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>职位</FormLabel>
                  <FormControl>
                    <Input placeholder="例如：销售经理" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="primary_dept_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>主部门</FormLabel>
                  <Select
                    value={field.value ?? 'null'}
                    onValueChange={(value) => field.onChange(value === 'null' ? null : value)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="选择主部门" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="null">未分配</SelectItem>
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
            {assignableRoles.length > 0 && (
              <FormField
                control={form.control}
                name="role_ids"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>角色</FormLabel>
                    <div className="space-y-2">
                      {assignableRoles.map((role) => (
                        <div key={role.id} className="flex items-center gap-2">
                          <Checkbox
                            checked={(field.value || []).includes(role.id)}
                            onCheckedChange={(checked) => {
                              const current = field.value || []
                              if (checked) {
                                field.onChange([...current, role.id])
                              } else {
                                field.onChange(current.filter((id) => id !== role.id))
                              }
                            }}
                          />
                          <span className="text-sm">{role.name}</span>
                        </div>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
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
