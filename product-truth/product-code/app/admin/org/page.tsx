import { OrgAdminWorkbench } from '@/components/admin/OrgAdminWorkbench'

// B11: 保留 /admin/org 入口，与 /configs?tab=org-structure 共存
// 避免破坏性变更，用户可以通过任一入口访问组织管理
export default function OrgAdminPage() {
  return <OrgAdminWorkbench />
}
