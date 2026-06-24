// B11 修复：统一组织与权限入口到配置中心
// OrgAdminWorkbench 已被 OrgStructureTab 取代
import { redirect } from 'next/navigation'

export default function OrgAdminPage() {
  redirect('/configs?tab=org-structure')
}
