// Streamline Freehand Duotone 风格图标系统
// 基于 https://www.streamlinehq.com/icons/freehand-duotone-free

import { cn } from '@/lib/utils'

interface IconProps {
  className?: string
  size?: number
}

// 基础 SVG 图标组件，带 Freehand Duotone 风格
function IconBase({
  children,
  className,
  size = 24
}: {
  children: React.ReactNode
  className?: string
  size?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("inline-block", className)}
    >
      {children}
    </svg>
  )
}

// 工作台 - 房子/仪表盘
export function HomeIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M3 9.5l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2v-11z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M9 22v-10h6v10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.6"
      />
    </IconBase>
  )
}

// 报价中心 - 货币/报价单
export function QuoteIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M12 2v20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.3" />
    </IconBase>
  )
}

// 合同审核 - 文档/合同
export function ContractIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M14 2v6h6M8 13h8M8 17h8M8 9h2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
    </IconBase>
  )
}

// 标书中心 - 证书/徽章
export function TenderIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.5" />
    </IconBase>
  )
}

// 知识库 - 书本/知识
export function KnowledgeIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M4 19.5A2.5 2.5 0 016.5 17H20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M9 7h6M9 11h6M9 15h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
    </IconBase>
  )
}

// 日程 - 日历/时钟
export function ScheduleIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <rect
        x="3"
        y="4"
        width="18"
        height="18"
        rx="2"
        ry="2"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M16 2v4M8 2v4M3 10h18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="15" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.5" />
    </IconBase>
  )
}

// 配置中心 - 齿轮/设置
export function SettingsIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.7"
      />
    </IconBase>
  )
}

// 退出登录 - 退出/箭头
export function LogoutIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M16 17l5-5-5-5M21 12H9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBase>
  )
}

// ========== UI 功能图标 ==========

// 上传
export function UploadIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M17 8l-5-5-5 5M12 3v12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBase>
  )
}

// 关闭/X
export function CloseIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M18 6L6 18M6 6l12 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBase>
  )
}

// 加载中/旋转
export function LoaderIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={cn("animate-spin", className)} size={size}>
      <path
        d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </IconBase>
  )
}

// AI/Bot
export function BotIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <rect
        x="3"
        y="11"
        width="18"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M8 11V7a4 4 0 118 0v4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="9" cy="16" r="1.5" fill="currentColor" />
      <circle cx="15" cy="16" r="1.5" fill="currentColor" />
    </IconBase>
  )
}

// 建筑/组织
export function BuildingIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M3 21h18M5 21V7l8-4 8 4v14M8 21v-4a2 2 0 014 0v4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M9 9h2M9 13h2M13 9h2M13 13h2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
    </IconBase>
  )
}

// 文件文本
export function FileTextIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M14 2v6h6M8 13h8M8 17h5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
    </IconBase>
  )
}

// 钥匙/权限
export function KeyRoundIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path
        d="M8 12v4a2 2 0 002 2h4a2 2 0 002-2v-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M12 16v4M10 20h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
    </IconBase>
  )
}

// 调色板
export function PaletteIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M12 6a2 2 0 100 4 2 2 0 000-4zM6 12a2 2 0 100 4 2 2 0 000-4zM12 14a2 2 0 100 4 2 2 0 000-4zM18 12a2 2 0 100 4 2 2 0 000-4z"
        fill="currentColor"
        opacity="0.6"
      />
    </IconBase>
  )
}

// 包裹/产品
export function PackageIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </IconBase>
  )
}

// 百分比
export function PercentIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M19 5L5 19M6.5 4a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM17.5 15a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </IconBase>
  )
}

// 盾牌检查
export function ShieldCheckIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M9 12l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBase>
  )
}

// 单用户/个人信息
export function UserIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path
        d="M20 21a8 8 0 00-16 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </IconBase>
  )
}

// 用户群
export function UsersIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path
        d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
    </IconBase>
  )
}

// 菜单/汉堡
export function MenuIcon({ className, size = 24 }: IconProps) {
  return (
    <IconBase className={className} size={size}>
      <path
        d="M4 6h16M4 12h16M4 18h16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBase>
  )
}
