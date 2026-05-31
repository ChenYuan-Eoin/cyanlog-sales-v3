import { PrismaClient } from '@prisma/client'

const globalForPrisma = global as unknown as { prisma: PrismaClient }

// REQ: F003
// 全局单例Prisma客户端，避免开发时热重载创建多个实例
export const prisma = globalForPrisma.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'error', 'warn']
    : ['error'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// 类型导出
export type { User, Quote, Contract, ContractReview, ApprovalRequest, RuleConfig } from '@prisma/client'
