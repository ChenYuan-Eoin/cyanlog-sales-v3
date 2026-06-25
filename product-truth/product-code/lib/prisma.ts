// REQ: F003
// NOTE: 项目已迁移到 Supabase，Prisma 仅用于 schema/migrations
// 此文件保留但不用于运行时查询
// 如需使用 Prisma，请先运行: npx prisma generate

// eslint-disable-next-line import/no-unresolved, @typescript-eslint/ban-ts-comment
// @ts-ignore - Prisma client 未生成时跳过类型检查
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

// 全局单例Prisma客户端，避免开发时热重载创建多个实例
export const prisma = globalForPrisma.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'error', 'warn']
    : ['error'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// 类型导出 - 从本地 types 重新导出（Prisma 未生成时使用）
// 如需使用 Prisma 类型，请取消下面的注释并运行 npx prisma generate
// export type { User, Quote, Contract, ContractReview, ApprovalRequest, RuleConfig } from '@prisma/client'

// 占位导出，避免模块为空
export type { } from '@prisma/client'
